import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, defineSubPlugin, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"

/**
 * The subscription sub-plugin, and mostly a record of what it does not build.
 *
 * The legacy dashboard's subscription page is a whole billing product: five
 * nav entries, invoices, coupons, a feature catalog, subscription lifecycle,
 * plan pricing and tier editing. Every one of those is an HTMX form post
 * handled directly in `dashboard.go`, and none of them reaches the dispatcher.
 * Verified against `plugins/subscription/contract/`, there are five intents
 * and two of them are commands:
 *
 *   plans.list                       -> { plans: PlanSummary[] }   no input, no paging
 *   plans.detail({ id })              -> PlanDetail                 PlanSummary + features?
 *   plans.archive({ id })             -> { ok }
 *   plans.activate({ id })            -> { ok }
 *   subscriptions.list({ tenantId })  -> { subscriptions: SubscriptionSummary[] }
 *
 * So `/plans` lists and `/plans/:id` reads, with archive and activate as the
 * only writes on the page. There is no `plans.create` intent, no pricing
 * intent and no feature intent, so this ships no editor: a plan detail page
 * with a pricing form that has nothing to submit to would be worse than not
 * having one at all. The plans list carries a single line pointing operators
 * back at the legacy dashboard for invoices, coupons and subscription changes,
 * because an operator who finds Plans here and concludes billing has moved
 * would otherwise go looking for invoices and find nothing.
 *
 * `subscriptions.list` requires a `tenantId` and answers an EMPTY LIST when
 * given none, with no error. A tab that forgets the parameter renders "no
 * subscriptions" and looks entirely correct doing it, so `SubscriptionOrgTab`
 * and `SubscriptionUserSection` both refuse to query at all without one.
 */

export interface PlanSummary {
  id: string
  name: string
  slug: string
  description?: string
  currency?: string
  status: string
  trialDays?: number
}

export interface PlanFeature {
  key: string
  name: string
  type: string
  limit: number
  period: string
}

/** `plans.detail`. PlanDetail embeds PlanSummary in Go, so the JSON is flat. */
export interface PlanDetail extends PlanSummary {
  features?: PlanFeature[]
}

export interface SubscriptionSummary {
  id: string
  tenantId: string
  planId: string
  status: string
  currentPeriodStart?: string
  currentPeriodEnd?: string
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
  const [target, setTarget] = useState<{ plan: PlanSummary; action: PlanAction } | null>(null)

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
      cell: (plan) => <PluginLink to={`/@auth/plans/${plan.id}`}>{plan.name}</PluginLink>,
    },
    { id: "slug", header: "Slug", className: "font-mono text-xs", cell: (plan) => plan.slug },
    {
      id: "currency",
      header: "Currency",
      cell: (plan) => (plan.currency ? plan.currency.toUpperCase() : <NoneCell label="currency" />),
    },
    {
      id: "trial",
      header: "Trial",
      cell: (plan) => (plan.trialDays ? `${plan.trialDays}d` : <NoneCell label="trial" />),
    },
    { id: "status", header: "Status", cell: (plan) => <PlanStatusBadge status={plan.status} /> },
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Plans" />
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

      {/*
        There is no plans.create intent, no pricing intent and no feature
        intent, so this line is the whole answer to "where did billing go"
        rather than a form with nothing behind it.
      */}
      <p className="text-sm text-muted-foreground">
        Invoices, coupons and subscription changes are managed in the legacy
        dashboard.
      </p>

      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`${target?.action === "activate" ? "Activate" : "Archive"} ${target?.plan.name ?? ""}?`}
        description={
          <>
            <span>
              {target?.action === "activate"
                ? "The plan becomes available for new subscriptions."
                : "The plan stops being offered for new subscriptions."}
            </span>
            {/*
              Base UI marks everything outside an open dialog inert and
              aria-hidden, so this has to render inside the dialog itself, as
              a span rather than a div: AlertDialogDescription renders a <p>,
              and a <div> is not valid <p> content.
            */}
            {command.error && (
              <span role="alert" className="mt-2 block font-medium text-destructive">
                Could not {target?.action}: {command.error.message} ({command.error.code})
              </span>
            )}
          </>
        }
        confirmLabel={target?.action === "activate" ? "Activate" : "Archive"}
        destructive={target?.action !== "activate"}
        pending={command.loading}
        onConfirm={() => void confirm()}
      />
    </section>
  )
}

/* ---------------------------------------------------------------- detail */

function PlanDetailBody({ id }: { id: string }) {
  const query = useQuery<PlanDetail>("plans.detail", { id })

  const columns: Column<PlanFeature>[] = [
    { id: "key", header: "Key", className: "font-mono text-xs", cell: (feature) => feature.key },
    { id: "name", header: "Name", cell: (feature) => feature.name },
    { id: "type", header: "Type", cell: (feature) => <Badge variant="outline">{feature.type}</Badge> },
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
              <PageHeader title={plan.name} description={plan.slug} />
              {/* Read-only. There is no pricing intent and no feature intent: a
                  form here would have nothing to submit to. */}
              <DescriptionList
                items={[
                  { term: "Plan ID", value: <span className="font-mono text-xs">{plan.id}</span> },
                  { term: "Slug", value: <span className="font-mono text-xs">{plan.slug}</span> },
                  {
                    term: "Currency",
                    value: plan.currency ? plan.currency.toUpperCase() : <NoneCell label="currency" />,
                  },
                  { term: "Status", value: <PlanStatusBadge status={plan.status} /> },
                  {
                    term: "Trial days",
                    value: plan.trialDays ? `${plan.trialDays}d` : <NoneCell label="trial" />,
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
  if (status === "active" || status === "trialing") return <Badge variant="default">{status}</Badge>
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
  const query = useQuery<SubscriptionsListResponse>("subscriptions.list", { tenantId })
  const plansQuery = useQuery<PlansListResponse>("plans.list")

  return (
    <QueryBoundary title="Subscription" query={query} skeletonRows={2}>
      {(data) => {
        const subscriptions = data.subscriptions ?? []
        if (subscriptions.length === 0) {
          return <p className="text-sm text-muted-foreground">No active subscription.</p>
        }

        const planName = (planId: string) =>
          plansQuery.data?.plans.find((plan) => plan.id === planId)?.name ?? planId

        return (
          <div className="flex flex-col gap-3">
            {subscriptions.map((subscription) => (
              <div key={subscription.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{planName(subscription.planId)}</span>
                  <SubscriptionStatusBadge status={subscription.status} />
                </div>
                <div className="text-muted-foreground">
                  Period ends{" "}
                  <Timestamp value={subscription.currentPeriodEnd} label="period end" />
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
  return <SubscriptionsForTenant tenantId={orgId} />
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
  host: "auth",
  label: "Plans",
  nav: [{ label: "Plans", to: "/plans", group: "Configuration", priority: 2 }],
  routes: [
    { path: "/plans", element: PlansPage },
    { path: "/plans/:id", element: PlanDetailPage },
  ],
  // Reads nothing of its host's. Every intent it uses is its own.
  hostIntents: [],
  contributions: {
    // `SlotContribution.render` takes `ComponentType<Record<string, unknown>>`,
    // and comparing it against the narrower `{ orgId?: string }` /
    // `{ userId?: string }` prop types needs the same cast settings-only.tsx
    // uses for its settings panel: the component ignores any params it does
    // not know about, so the cast changes nothing at runtime.
    "org.detail.tabs": [
      {
        id: "billing",
        label: "Billing",
        priority: 10,
        render: SubscriptionOrgTab as unknown as ComponentType<Record<string, unknown>>,
      },
    ],
    "user.detail.sections": [
      {
        id: "subscription",
        priority: 20,
        render: SubscriptionUserSection as unknown as ComponentType<Record<string, unknown>>,
      },
    ],
  },
})
