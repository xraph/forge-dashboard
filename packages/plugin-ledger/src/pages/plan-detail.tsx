import { useState } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { PlanStatusBadge } from "../badges"
import { ConfirmAction } from "../components/confirm-action"
import { LedgerTable, type LedgerColumn } from "../components/ledger-table"
import { MoneyText } from "../components/money"
import { isNotFound, NotFoundState } from "../components/not-found"
import { SyncPanel } from "../components/sync-panel"
import { planEditPath } from "../lib/paths"
import type { Ack, Plan, PlanFeature, PriceTier } from "../types"

const number = new Intl.NumberFormat()
const PERIOD: Record<string, string> = { monthly: "Monthly", yearly: "Yearly", none: "Never" }
const TYPE: Record<string, string> = { metered: "Metered", seat: "Seats", boolean: "On or off" }

/** A feature's limit as a person reads it. -1 is unlimited; a boolean is on or off. */
function limitText(f: PlanFeature): string {
  if (f.type === "boolean") return f.limit > 0 ? "Included" : "Not included"
  if (f.limit === -1) return "Unlimited"
  return number.format(f.limit)
}

const featureColumns: LedgerColumn<PlanFeature>[] = [
  { id: "name", header: "Feature", className: "font-medium", cell: (f) => f.name },
  { id: "key", header: "Key", className: "font-mono text-xs", cell: (f) => f.key },
  { id: "type", header: "Type", cell: (f) => TYPE[f.type] ?? f.type },
  { id: "limit", header: "Limit", align: "end", className: "tabular-nums", cell: (f) => limitText(f) },
  { id: "resets", header: "Resets", cell: (f) => PERIOD[f.period] ?? f.period },
  { id: "soft", header: "Over the limit", cell: (f) => (f.soft_limit ? "Soft" : <NoneCell label="soft limit" />) },
]

interface TierRow extends PriceTier {
  from: number
}

const tierColumns: LedgerColumn<TierRow>[] = [
  { id: "type", header: "Type", cell: (t) => t.type.charAt(0).toUpperCase() + t.type.slice(1) },
  { id: "from", header: "From", align: "end", className: "tabular-nums", cell: (t) => number.format(t.from) },
  { id: "to", header: "Up to", align: "end", className: "tabular-nums", cell: (t) => (t.up_to === -1 ? "No limit" : number.format(t.up_to)) },
  { id: "unit", header: "Unit price", align: "end", cell: (t) => <MoneyText value={t.unit_amount} /> },
  { id: "flat", header: "Flat fee", align: "end", cell: (t) => <MoneyText value={t.flat_amount} /> },
]

/** Tiers grouped by feature in priority order, each knowing where it starts. */
function tierGroups(plan: Plan): { key: string; name: string; tiers: TierRow[] }[] {
  const groups = new Map<string, PriceTier[]>()
  for (const t of plan.pricing?.tiers ?? []) groups.set(t.feature_key, [...(groups.get(t.feature_key) ?? []), t])
  return [...groups.entries()].map(([key, tiers]) => {
    const sorted = [...tiers].sort((a, b) => a.priority - b.priority)
    let from = 1
    const rows = sorted.map((t) => {
      const row = { ...t, from }
      from = t.up_to === -1 ? from : t.up_to + 1
      return row
    })
    return { key, name: (plan.features ?? []).find((f) => f.key === key)?.name ?? key, tiers: rows }
  })
}

export function LedgerPlanDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No plan id in the address, so there is nothing to show.
      </p>
    )
  }
  return <PlanDetailBody id={id} />
}

function PlanDetailBody({ id }: { id: string }) {
  const detail = useQuery<Plan>("plans.detail", { id })
  // Once there is data the page stays up through a refresh: a write
  // invalidates plans.detail, and QueryBoundary would otherwise swap the page
  // for a skeleton and take any open dialog with it.
  if (detail.data !== undefined) return <PlanDetailView plan={detail.data} />
  if (isNotFound(detail.error, "plan")) return <NotFoundState noun="plan" id={id} backTo="/plans" backLabel="Back to plans" />
  return (
    <QueryBoundary title="Plan" query={detail} skeletonRows={6}>
      {(p) => <PlanDetailView plan={p} />}
    </QueryBoundary>
  )
}

type Pending = "archive" | "activate" | "delete" | null

function PlanDetailView({ plan }: { plan: Plan }) {
  const archive = useCommand<Ack>("plans.archive")
  const activate = useCommand<Ack>("plans.activate")
  const remove = useCommand<Ack>("plans.delete")
  const navigate = useNavigateTo()
  const [pending, setPending] = useState<Pending>(null)
  const features = plan.features ?? []
  const groups = tierGroups(plan)
  const period = plan.pricing?.billing_period === "yearly" ? "per year" : "per month"

  function openDialog(which: Exclude<Pending, null>) {
    // Reset at open, so an earlier refusal is not shown against this attempt.
    ;({ archive, activate, delete: remove })[which].reset()
    setPending(which)
  }

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={plan.name}
        description={plan.description || undefined}
        actions={
          <>
            <PluginLink to={planEditPath(plan.id)} className={buttonVariants({ variant: "outline" })}>
              Edit
            </PluginLink>
            {plan.status === "active" ? (
              <Button variant="outline" onClick={() => openDialog("archive")}>
                Archive
              </Button>
            ) : (
              <Button variant="outline" onClick={() => openDialog("activate")}>
                Activate
              </Button>
            )}
            <Button variant="destructive" onClick={() => openDialog("delete")}>
              Delete
            </Button>
          </>
        }
      />

      <DetailLayout
        main={
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-base font-medium">Features</h2>
              <LedgerTable<PlanFeature>
                columns={featureColumns}
                rows={features}
                rowKey={(f) => f.id}
                caption={`${features.length} ${features.length === 1 ? "feature" : "features"}`}
                emptyMessage="This plan grants no features beyond its base price."
              />
            </section>
            <section className="flex flex-col gap-4">
              <h2 className="text-base font-medium">Usage pricing</h2>
              {groups.length === 0 ? (
                <p className="text-sm text-muted-foreground">No usage pricing: this plan charges its base price only.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">
                      {g.name} <span className="font-mono text-xs text-muted-foreground">{g.key}</span>
                    </h3>
                    <LedgerTable<TierRow>
                      columns={tierColumns}
                      rows={g.tiers}
                      rowKey={(t) => `${t.feature_key}-${t.priority}`}
                      caption={`${g.tiers.length} ${g.tiers.length === 1 ? "tier" : "tiers"} for ${g.key}`}
                      emptyMessage="No tiers."
                    />
                  </div>
                ))
              )}
            </section>
          </>
        }
        aside={
          <>
            <section className="flex flex-col gap-3" aria-label="Pricing">
              <h2 className="text-sm font-medium">Price</h2>
              {plan.pricing ? (
                <p className="flex items-baseline gap-2">
                  <MoneyText value={plan.pricing.base_amount} className="text-2xl font-medium" />
                  <span className="text-sm text-muted-foreground">{period}</span>
                </p>
              ) : (
                <NoneCell label="price" />
              )}
              <DescriptionList
                items={[
                  { term: "Status", value: <PlanStatusBadge status={plan.status} /> },
                  { term: "Slug", value: <span className="font-mono text-xs">{plan.slug}</span> },
                  { term: "Currency", value: <span className="font-mono text-xs">{plan.currency.toUpperCase()}</span> },
                  { term: "Trial", value: plan.trial_days > 0 ? `${plan.trial_days} days` : <NoneCell label="trial" /> },
                  { term: "Created", value: <Timestamp value={plan.created_at} label="creation" /> },
                  { term: "Updated", value: <Timestamp value={plan.updated_at} label="update" /> },
                ]}
              />
            </section>
            <SyncPanel intent="plans.syncToProvider" id={plan.id} providerName={plan.provider_name} providerId={plan.provider_id} />
          </>
        }
      />

      <ConfirmAction
        open={pending === "archive"}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Archive ${plan.name}?`}
        description="Nothing new can subscribe to it. Current subscriptions stay on it until they change plan or end."
        confirmLabel="Archive plan"
        command={archive}
        payload={{ id: plan.id }}
        onDone={() => setPending(null)}
      />
      <ConfirmAction
        open={pending === "activate"}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Activate ${plan.name}?`}
        description="Tenants can subscribe to it from now on."
        confirmLabel="Activate plan"
        command={activate}
        payload={{ id: plan.id }}
        onDone={() => setPending(null)}
      />
      <ConfirmAction
        open={pending === "delete"}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Delete ${plan.name}?`}
        description="This cannot be undone. A plan with subscriptions cannot be deleted; archive it instead."
        confirmLabel="Delete plan"
        destructive
        command={remove}
        payload={{ id: plan.id }}
        onDone={() => navigate("/plans")}
      />
    </section>
  )
}

export default LedgerPlanDetailPage
