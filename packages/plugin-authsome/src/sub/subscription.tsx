import { useState } from "react"
import {
  PluginLink,
  defineSubPlugin,
  useCommand,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "../components/presentation"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { CreditCard } from "@forge-go/dashboard-kit/icons"
import { Panel } from "../components/presentation"
import { PageLink } from "../components/presentation"
import {
  PlanCreatePage,
  PlanEditPage,
  SubscriptionsPage,
  InvoicesPage,
  CouponsPage,
  BillingFeaturesPage,
  SubscriptionDetailPage,
  InvoiceDetailPage,
} from "./billing"
import { ResourceTable, type Column } from "../components/presentation"
import { formatMinorMoney } from "./money"

export interface PlanSummary {
  id: string
  name: string
  slug: string
  description?: string
  currency?: string
  status: string
  trialDays?: number
  baseAmount?: number
  billingPeriod?: string
}

export interface PlanFeature {
  id?: string
  key: string
  name: string
  type: string
  limit: number
  period: string
  softLimit?: boolean
  catalogId?: string
}

export interface PriceTier {
  featureKey: string
  type: string
  upTo: number
  unitAmount: number
  flatAmount: number
}

/** `plans.detail`. PlanDetail embeds PlanSummary in Go, so the JSON is flat. */
export interface PlanDetail extends PlanSummary {
  features?: PlanFeature[]
  tiers?: PriceTier[]
}

export interface SubscriptionSummary {
  id: string
  tenantId: string
  planId: string
  status: string
  currentPeriodStart?: string
  currentPeriodEnd?: string
  cancelAt?: string
}

interface PlansListResponse {
  plans: PlanSummary[]
}

interface SubscriptionsListResponse {
  subscriptions: SubscriptionSummary[]
}

interface AckResponse {
  ok: boolean
}

function PlanStatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge variant="default">{status}</Badge>
  if (status === "draft") return <Badge variant="secondary">{status}</Badge>
  return <Badge variant="outline">{status}</Badge>
}

/* ------------------------------------------------------------------ list */

type PlanAction = "archive" | "activate"

export function PlansPage() {
  const query = useQuery<PlansListResponse>("plans.list")
  const archive = useCommand<AckResponse>("plans.archive")
  const activate = useCommand<AckResponse>("plans.activate")
  const [target, setTarget] = useState<{
    plan: PlanSummary
    action: PlanAction
  } | null>(null)

  const command = target?.action === "activate" ? activate : archive

  function openDialog(plan: PlanSummary, action: PlanAction) {
    // Reset at open, not at close: one hook serves every row, so a failure
    // left over from a different plan's row must not follow the operator to
    // one they have not touched yet.
    archive.reset()
    activate.reset()
    setTarget({ plan, action })
  }

  async function confirm() {
    if (!target) return
    const result = await command.execute({ id: target.plan.id })
    if (result === undefined) return
    setTarget(null)
  }

  const columns: Column<PlanSummary>[] = [
    {
      id: "name",
      header: "Name",
      className: "font-medium",
      cell: (plan) => (
        <PluginLink to={`/plans/${plan.id}`}>{plan.name}</PluginLink>
      ),
    },
    {
      id: "slug",
      header: "Slug",
      className: "font-mono text-xs",
      cell: (plan) => plan.slug,
    },
    {
      id: "currency",
      header: "Currency",
      cell: (plan) =>
        plan.currency ? (
          plan.currency.toUpperCase()
        ) : (
          <NoneCell label="currency" />
        ),
    },
    {
      id: "trial",
      header: "Trial",
      cell: (plan) =>
        plan.trialDays ? `${plan.trialDays}d` : <NoneCell label="trial" />,
    },
    {
      id: "status",
      header: "Status",
      cell: (plan) => <PlanStatusBadge status={plan.status} />,
    },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Plans"
        actions={
          <PageLink to="/plans/new" primary>
            New plan
          </PageLink>
        }
      />
      {/*
        plans.list takes no input and answers its whole collection, same as
        orgs.list. There is no cursor and nothing here to page.
      */}
      <QueryBoundary title="Plans" query={query} skeletonRows={5}>
        {(data) => {
          const rows = data.plans ?? []
          const caption = `${rows.length} ${rows.length === 1 ? "plan" : "plans"}`
          return (
            <ResourceTable<PlanSummary>
              columns={columns}
              rows={rows}
              rowKey={(plan) => plan.id}
              caption={caption}
              emptyMessage="No plans yet."
              rowActions={(plan) => {
                if (plan.status === "active") {
                  return (
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label={`Archive ${plan.name}`}
                      onClick={() => openDialog(plan, "archive")}
                    >
                      Archive
                    </Button>
                  )
                }
                if (plan.status === "draft") {
                  return (
                    <Button
                      size="sm"
                      aria-label={`Activate ${plan.name}`}
                      onClick={() => openDialog(plan, "activate")}
                    >
                      Activate
                    </Button>
                  )
                }
                return null
              }}
            />
          )
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`${target?.action === "activate" ? "Activate" : "Archive"} ${target?.plan.name ?? ""}?`}
        description={
          target?.action === "activate"
            ? "The plan becomes available for new subscriptions."
            : "The plan stops being offered for new subscriptions."
        }
        confirmLabel={target?.action === "activate" ? "Activate" : "Archive"}
        destructive={target?.action !== "activate"}
        pending={command.loading}
        onConfirm={() => void confirm()}
      >
        {/*
          Base UI marks everything outside an open dialog inert and
          aria-hidden, so this has to render inside the dialog itself.
        */}
        <CommandAlert
          title={`Could not ${target?.action ?? "archive"}`}
          error={command.error}
        />
      </ConfirmDialog>
    </section>
  )
}

/* ---------------------------------------------------------------- detail */

function PlanDetailBody({ id }: { id: string }) {
  const query = useQuery<PlanDetail>("plans.detail", { id })

  const columns: Column<PlanFeature>[] = [
    {
      id: "key",
      header: "Key",
      className: "font-mono text-xs",
      cell: (feature) => feature.key,
    },
    { id: "name", header: "Name", cell: (feature) => feature.name },
    {
      id: "type",
      header: "Type",
      cell: (feature) => <Badge variant="outline">{feature.type}</Badge>,
    },
    {
      id: "limit",
      header: "Limit",
      cell: (feature) => (feature.limit <= 0 ? "Unlimited" : feature.limit),
    },
    { id: "period", header: "Period", cell: (feature) => feature.period },
  ]

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Plan" query={query} skeletonRows={4}>
        {(plan) => {
          const features = plan.features ?? []
          const caption = `${features.length} ${features.length === 1 ? "feature" : "features"}`
          return (
            <>
              <PageHeader
                title={plan.name}
                description={plan.slug}
                actions={
                  <PageLink to={`/plans/${plan.id}/edit`}>Edit plan</PageLink>
                }
              />
              <DescriptionList
                items={[
                  {
                    term: "Plan ID",
                    value: <span className="font-mono text-xs">{plan.id}</span>,
                  },
                  {
                    term: "Slug",
                    value: (
                      <span className="font-mono text-xs">{plan.slug}</span>
                    ),
                  },
                  {
                    term: "Currency",
                    value: plan.currency ? (
                      plan.currency.toUpperCase()
                    ) : (
                      <NoneCell label="currency" />
                    ),
                  },
                  {
                    term: "Status",
                    value: <PlanStatusBadge status={plan.status} />,
                  },
                  {
                    term: "Trial days",
                    value: plan.trialDays ? (
                      `${plan.trialDays}d`
                    ) : (
                      <NoneCell label="trial" />
                    ),
                  },
                  {
                    term: "Base price",
                    value: plan.baseAmount
                      ? `${formatMinorMoney(plan.baseAmount, plan.currency ?? "usd")} / ${plan.billingPeriod}`
                      : "Free",
                  },
                  {
                    term: "Description",
                    value: plan.description ?? <NoneCell label="description" />,
                  },
                ]}
              />
              <ResourceTable<PlanFeature>
                columns={columns}
                rows={features}
                rowKey={(feature) => feature.key}
                caption={caption}
                emptyMessage="No features on this plan."
              />
              {!!plan.tiers?.length && (
                <ResourceTable<PriceTier>
                  columns={[
                    {
                      id: "feature",
                      header: "Feature",
                      cell: (tier) => tier.featureKey,
                    },
                    {
                      id: "type",
                      header: "Tier type",
                      cell: (tier) => tier.type,
                    },
                    {
                      id: "upTo",
                      header: "Up to",
                      cell: (tier) => tier.upTo || "Unlimited",
                    },
                    {
                      id: "unit",
                      header: "Unit amount",
                      cell: (tier) =>
                        formatMinorMoney(
                          tier.unitAmount,
                          plan.currency ?? "usd"
                        ),
                    },
                    {
                      id: "flat",
                      header: "Flat amount",
                      cell: (tier) =>
                        formatMinorMoney(
                          tier.flatAmount,
                          plan.currency ?? "usd"
                        ),
                    },
                  ]}
                  rows={plan.tiers}
                  rowKey={(tier) =>
                    `${tier.featureKey}-${tier.type}-${tier.upTo}-${tier.unitAmount}-${tier.flatAmount}`
                  }
                  caption={`${plan.tiers.length} pricing tiers`}
                  emptyMessage="No pricing tiers."
                />
              )}
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}

export function PlanDetailPage({ params }: PluginPageProps) {
  const id = params.id

  // A detail route reached without an id is a link somebody built wrong, not
  // a server state, so this says so rather than issuing plans.detail with an
  // undefined id and rendering whatever the server makes of that.
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No plan selected.
      </p>
    )
  }

  return <PlanDetailBody id={id} />
}

/* ---------------------------------------------------------- shared summary */

function SubscriptionStatusBadge({ status }: { status: string }) {
  if (status === "active" || status === "trialing")
    return <Badge variant="default">{status}</Badge>
  if (status === "canceled" || status === "cancelled" || status === "expired") {
    return <Badge variant="outline">{status}</Badge>
  }
  return <Badge variant="secondary">{status}</Badge>
}

/**
 * Shared by the org tab and the user section. Both read
 * `subscriptions.list({ tenantId })` and both resolve the plan name through
 * `plans.list`: `SubscriptionSummary` carries `planId` and no plan name, and
 * "p1" tells an operator nothing.
 */
function SubscriptionsForTenant({ tenantId }: { tenantId: string }) {
  const query = useQuery<SubscriptionsListResponse>("subscriptions.list", {
    tenantId,
  })
  const plansQuery = useQuery<PlansListResponse>("plans.list")

  return (
    <QueryBoundary title="Subscription" query={query} skeletonRows={2}>
      {(data) => {
        const subscriptions = data.subscriptions ?? []
        if (subscriptions.length === 0) {
          return (
            <ZeroState
              title="No subscriptions"
              body="No subscription is linked to this account."
              illustration={<CreditCard className="size-6 stroke-[1.5]" />}
              action={
                <PluginLink
                  to="/plans"
                  className="text-sm underline underline-offset-4"
                >
                  View plans
                </PluginLink>
              }
            />
          )
        }

        const planName = (planId: string) =>
          plansQuery.data?.plans.find((plan) => plan.id === planId)?.name ??
          planId

        return (
          <div className="flex flex-col gap-3">
            {subscriptions.map((subscription) => (
              <div
                key={subscription.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-4 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {planName(subscription.planId)}
                  </span>
                  <SubscriptionStatusBadge status={subscription.status} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Period ends{" "}
                  <Timestamp
                    value={subscription.currentPeriodEnd}
                    label="period end"
                  />
                </div>
              </div>
            ))}
          </div>
        )
      }}
    </QueryBoundary>
  )
}

/**
 * Contributes to the organization sub-plugin's `org.detail.tabs` slot.
 *
 * `subscriptions.list` answers an empty list for an empty `tenantId`, with no
 * error, so a missing org id has to stop this from querying at all rather
 * than rendering "no subscriptions" and looking correct doing it. A slot
 * contribution with nothing to say renders nothing, not an empty card: the
 * host cannot see it and cannot lay out around it.
 */
export function SubscriptionOrgTab({ orgId }: { orgId?: string }) {
  if (!orgId) return null
  return (
    <Panel
      title="Subscriptions"
      description="Plans linked to this organization"
    >
      <SubscriptionsForTenant tenantId={orgId} />
    </Panel>
  )
}

export function SubscriptionOrgSummary({
  orgId,
  onOpenTab,
}: {
  orgId?: string
  onOpenTab?: (key: string) => void
}) {
  if (!orgId) return null
  return <SubscriptionOrgSummaryContent orgId={orgId} onOpenTab={onOpenTab} />
}

function SubscriptionOrgSummaryContent({
  orgId,
  onOpenTab,
}: {
  orgId: string
  onOpenTab?: (key: string) => void
}) {
  const query = useQuery<SubscriptionsListResponse>("subscriptions.list", {
    tenantId: orgId,
  })
  const plansQuery = useQuery<PlansListResponse>("plans.list")

  return (
    <Panel
      title="Billing"
      actions={
        onOpenTab && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenTab("subscription:billing")}
          >
            View billing
          </Button>
        )
      }
    >
      <QueryBoundary title="Billing" query={query} skeletonRows={1}>
        {(data) => {
          const subscriptions = data.subscriptions ?? []
          const current =
            subscriptions.find(
              (item) => item.status === "active" || item.status === "trialing"
            ) ?? subscriptions[0]
          if (!current)
            return (
              <ZeroState
                title="No subscription linked"
                body="Open billing to review this organization's subscriptions."
                illustration={<CreditCard className="size-6 stroke-[1.5]" />}
                className="border-0 bg-transparent p-0"
              />
            )
          const name =
            plansQuery.data?.plans.find((plan) => plan.id === current.planId)
              ?.name ?? current.planId
          return (
            <div className="flex min-w-0 items-center gap-3">
              <div
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
              >
                <CreditCard className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{name}</div>
                <div className="text-xs text-muted-foreground">
                  {subscriptions.length}{" "}
                  {subscriptions.length === 1
                    ? "subscription"
                    : "subscriptions"}
                </div>
              </div>
              <SubscriptionStatusBadge status={current.status} />
            </div>
          )
        }}
      </QueryBoundary>
    </Panel>
  )
}

/**
 * Contributes to the auth plugin's `user.detail.sections` slot. Same shape
 * and same refusal as {@link SubscriptionOrgTab}, keyed to the user instead
 * of the organization.
 */
export function SubscriptionUserSection({ userId }: { userId?: string }) {
  if (!userId) return null
  return <SubscriptionsForTenant tenantId={userId} />
}

/* ------------------------------------------------------------ declaration */

export const subscriptionSubPlugin = defineSubPlugin({
  extension: "subscription",
  host: "authsome",
  label: "Subscription",
  nav: [
    {
      label: "Plans",
      to: "/plans",
      group: "Billing",
      priority: 0,
      cluster: { label: "Billing", icon: <CreditCard /> },
    },
    {
      label: "Subscriptions",
      to: "/billing/subscriptions",
      group: "Billing",
      priority: 1,
      cluster: { label: "Billing", icon: <CreditCard /> },
    },
    {
      label: "Invoices",
      to: "/billing/invoices",
      group: "Billing",
      priority: 2,
      cluster: { label: "Billing", icon: <CreditCard /> },
    },
    {
      label: "Coupons",
      to: "/billing/coupons",
      group: "Billing",
      priority: 3,
      cluster: { label: "Billing", icon: <CreditCard /> },
    },
    {
      label: "Feature catalog",
      to: "/billing/features",
      group: "Billing",
      priority: 4,
      cluster: { label: "Billing", icon: <CreditCard /> },
    },
  ],
  routes: [
    { path: "/plans", element: PlansPage },
    { path: "/plans/new", element: PlanCreatePage },
    { path: "/plans/:id/edit", element: PlanEditPage },
    { path: "/plans/:id", element: PlanDetailPage },
    { path: "/billing/subscriptions", element: SubscriptionsPage },
    { path: "/billing/subscriptions/:id", element: SubscriptionDetailPage },
    { path: "/billing/invoices", element: InvoicesPage },
    { path: "/billing/invoices/:id", element: InvoiceDetailPage },
    { path: "/billing/coupons", element: CouponsPage },
    { path: "/billing/features", element: BillingFeaturesPage },
  ],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
  contributions: {
    "org.detail.summary": [
      { id: "billing-summary", priority: 10, render: SubscriptionOrgSummary },
    ],
    "org.detail.tabs": [
      {
        id: "billing",
        label: "Billing",
        priority: 10,
        render: SubscriptionOrgTab,
      },
    ],
    "user.detail.sections": [
      {
        id: "subscription",
        priority: 20,
        render: SubscriptionUserSection,
      },
    ],
  },
})
