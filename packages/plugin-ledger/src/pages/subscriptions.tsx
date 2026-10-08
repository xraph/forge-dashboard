import { useState } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { SUBSCRIPTION_STATUS_OPTIONS, SubscriptionStatusBadge } from "../badges"
import { ImportFromProviderAction } from "../components/import-from-provider"
import { BackToFirstPage, OffsetPager } from "../components/offset-pager"
import { formatPeriod } from "../lib/datetime"
import { listEmptyMessage, pageCaption, pageParams } from "../lib/paging"
import { subscriptionPath } from "../lib/paths"
import type { Page, Plan, Subscription, SubscriptionDetail } from "../types"

/**
 * Plan names by id, from one wide read of the plan list. A subscription
 * carries only its plan_id; a name reads better, and an id the list does not
 * contain (a plan deleted since, or past the first 200), or that has no name,
 * falls back to the id, never to a blank.
 */
function usePlanNames(): Map<string, string> {
  const plans = useQuery<Page<Plan>>("plans.list", { limit: 200, offset: 0 })
  const named = (plans.data?.items ?? []).filter((p) => p.name.trim() !== "")
  return new Map(named.map((p) => [p.id, p.name]))
}

function NewSubscriptionLink() {
  return (
    <PluginLink to="/subscriptions/new" className={buttonVariants()}>
      New subscription
    </PluginLink>
  )
}

export function LedgerSubscriptionsPage() {
  const [page, setPage] = useState(1)
  const [tenant, setTenant] = useState("")
  const [status, setStatus] = useState("")
  const tenantId = tenant.trim()
  const list = useQuery<Page<Subscription>>("subscriptions.list", {
    ...pageParams(page),
    tenant_id: tenantId || undefined,
    status: status || undefined,
  })
  const planNames = usePlanNames()

  const columns: Column<Subscription>[] = [
    {
      id: "tenant",
      header: "Tenant",
      className: "font-mono text-xs font-medium",
      cell: (s) => (
        <PluginLink to={subscriptionPath(s.id)}>{s.tenant_id}</PluginLink>
      ),
    },
    {
      id: "plan",
      header: "Plan",
      cell: (s) =>
        planNames.get(s.plan_id) ?? (
          <span className="font-mono text-xs">{s.plan_id}</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (s) => <SubscriptionStatusBadge status={s.status} />,
    },
    {
      id: "period",
      header: "Current period",
      cell: (s) => formatPeriod(s.current_period_start, s.current_period_end),
    },
    {
      id: "cancels",
      header: "Cancels",
      // The engine never writes ended_at: a canceled subscription carries
      // canceled_at, the moment it stopped, and a scheduled one only cancel_at.
      cell: (s) => (
        <Timestamp
          value={s.status === "canceled" ? s.canceled_at : s.cancel_at}
          label="cancellation"
        />
      ),
    },
    {
      id: "created",
      header: "Started",
      cell: (s) => <Timestamp value={s.created_at} label="start" />,
    },
  ]

  const statusLabel = SUBSCRIPTION_STATUS_OPTIONS.find(
    (s) => s.value === status
  )?.label.toLowerCase()
  const emptyMessage =
    page === 1 && tenantId
      ? `No ${statusLabel ? `${statusLabel} ` : ""}subscriptions for ${tenantId}.`
      : listEmptyMessage("subscriptions", page, statusLabel)

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Subscriptions"
        description="Every tenant's subscription in this app."
        actions={
          <>
            <ImportFromProviderAction<SubscriptionDetail>
              intent="subscriptions.importFromProvider"
              noun="subscription"
              description="Copies one subscription from the payment provider into this app. Its plan must already be an active plan here. Import the plan first if this app lacks it, or activate it if it is not active yet."
              pathOf={(d) => subscriptionPath(d.subscription.id)}
            />
            <NewSubscriptionLink />
          </>
        }
      />
      <FilterBar
        search={{
          value: tenant,
          onChange: (next) => {
            setTenant(next)
            setPage(1)
          },
          placeholder: "Exact tenant ID",
          label: "Tenant ID",
        }}
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            options: [
              { label: "All", value: "" },
              ...SUBSCRIPTION_STATUS_OPTIONS,
            ],
            onChange: (next) => {
              setStatus(next)
              setPage(1)
            },
          },
        ]}
      />
      <QueryBoundary title="Subscriptions" query={list} skeletonRows={5}>
        {(data) => {
          const rows = data.items ?? []
          return (
            <div className="flex flex-col gap-3">
              <ResourceTable<Subscription>
                columns={columns}
                rows={rows}
                rowKey={(s) => s.id}
                caption={pageCaption({
                  page,
                  shown: rows.length,
                  hasMore: data.has_more,
                  singular: "subscription",
                  plural: "subscriptions",
                })}
                emptyMessage={emptyMessage}
                emptyAction={
                  page > 1 ? (
                    <BackToFirstPage onClick={() => setPage(1)} />
                  ) : !status && !tenantId ? (
                    <NewSubscriptionLink />
                  ) : undefined
                }
              />
              <OffsetPager
                page={page}
                hasMore={data.has_more}
                onPageChange={setPage}
              />
            </div>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
