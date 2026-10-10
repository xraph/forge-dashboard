import { useState } from "react"
import type { FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  QueryBoundary,
  CommandAlert,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { ZeroState } from "@forge-go/dashboard-kit/components/zero-state"
import { CreditCard } from "@forge-go/dashboard-kit/icons"
import {
  PageLink,
  Panel,
  ResourceTable,
  DescriptionList,
  type Column,
} from "../components/presentation"
import type {
  PlanDetail,
  PlanFeature,
  PlanSummary,
  PriceTier,
  SubscriptionSummary,
} from "./subscription"
import { currencyDivisor, formatMinorMoney } from "./money"

interface Ack {
  ok: boolean
  id?: string
}
interface PlansList {
  plans: PlanSummary[]
}
interface SubscriptionsList {
  subscriptions: SubscriptionSummary[]
}
interface Invoice {
  id: string
  tenantId: string
  subscriptionId: string
  status: string
  currency: string
  total: number
  paymentRef?: string
}
interface SubscriptionDetail extends SubscriptionSummary {
  planName: string
  usage: {
    featureKey: string
    featureName: string
    featureType: string
    used: number
    limit: number
    remaining: number
    period: string
  }[]
  invoices: Invoice[]
}
interface InvoiceDetail extends Invoice {
  subtotal: number
  taxAmount: number
  discountAmount: number
  periodStart: string
  periodEnd: string
  lineItems: {
    description: string
    type: string
    featureKey?: string
    quantity: number
    unitAmount: number
    amount: number
  }[]
}
interface Coupon {
  id: string
  code: string
  name: string
  type: string
  amount: number
  percentage: number
  currency: string
  maxRedemptions: number
  timesRedeemed: number
  validFrom?: string
  validUntil?: string
}
interface CatalogFeature {
  id: string
  key: string
  name: string
  description: string
  type: string
  defaultLimit: number
  period: string
  softLimit: boolean
  status: string
}
const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
const money = formatMinorMoney
const field = (label: string, child: React.ReactNode) => (
  <label className="grid min-w-0 gap-1 text-sm font-medium">
    {label}
    {child}
  </label>
)

function PlanEditor({ plan }: { plan?: PlanDetail }) {
  const navigate = useNavigateTo()
  const create = useCommand<Ack>("plans.create")
  const update = useCommand<Ack>("plans.update")
  const command = plan ? update : create
  const [name, setName] = useState(plan?.name ?? "")
  const [slug, setSlug] = useState(plan?.slug ?? "")
  const [description, setDescription] = useState(plan?.description ?? "")
  const [currency, setCurrency] = useState(plan?.currency ?? "usd")
  const [trialDays, setTrialDays] = useState(plan?.trialDays ?? 0)
  const [baseAmount, setBaseAmount] = useState(
    (
      (plan?.baseAmount ?? 0) / currencyDivisor(plan?.currency ?? "usd")
    ).toString()
  )
  const [billingPeriod, setBillingPeriod] = useState(
    plan?.billingPeriod ?? "monthly"
  )
  const [features, setFeatures] = useState<PlanFeature[]>(plan?.features ?? [])
  const [tiers, setTiers] = useState<PriceTier[]>(plan?.tiers ?? [])
  const catalog = useQuery<{ features: CatalogFeature[] }>("features.list")

  async function save(event: FormEvent) {
    event.preventDefault()
    const amount = Math.round(Number(baseAmount) * currencyDivisor(currency))
    if (!Number.isFinite(amount) || amount < 0) return
    const result = await command.execute({
      id: plan?.id,
      name,
      slug,
      description,
      currency,
      trialDays,
      baseAmount: amount,
      billingPeriod,
      features,
      tiers,
    })
    if (result?.ok) navigate(`/plans/${result.id ?? plan?.id}`)
  }
  const changeFeature = (
    index: number,
    key: keyof PlanFeature,
    value: string | number | boolean
  ) =>
    setFeatures((items) =>
      items.map((item, at) => (at === index ? { ...item, [key]: value } : item))
    )
  const changeTier = (
    index: number,
    key: keyof PriceTier,
    value: string | number
  ) =>
    setTiers((items) =>
      items.map((item, at) => (at === index ? { ...item, [key]: value } : item))
    )

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title={plan ? `Edit ${plan.name}` : "New plan"}
        actions={
          <PageLink to={plan ? `/plans/${plan.id}` : "/plans"}>
            Back to plans
          </PageLink>
        }
      />
      <CommandAlert error={command.error} title="Could not complete action" />
      <form
        onSubmit={(event) => void save(event)}
        className="grid min-w-0 gap-4"
      >
        <Panel title="Plan details">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {field(
              "Name",
              <Input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
            {field(
              "Slug",
              <Input
                required
                disabled={!!plan}
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
              />
            )}
            {field(
              "Currency",
              <Input
                required
                disabled={!!plan}
                maxLength={3}
                value={currency}
                onChange={(event) => {
                  const nextCurrency = event.target.value.toLowerCase()
                  const oldDivisor = currencyDivisor(currency)
                  const newDivisor = currencyDivisor(nextCurrency)
                  setTiers((items) =>
                    items.map((item) => ({
                      ...item,
                      unitAmount: Math.round(
                        (item.unitAmount / oldDivisor) * newDivisor
                      ),
                      flatAmount: Math.round(
                        (item.flatAmount / oldDivisor) * newDivisor
                      ),
                    }))
                  )
                  setCurrency(nextCurrency)
                }}
              />
            )}
            {field(
              "Trial days",
              <Input
                type="number"
                min={0}
                value={trialDays}
                onChange={(event) => setTrialDays(Number(event.target.value))}
              />
            )}
            <div className="sm:col-span-2">
              {field(
                "Description",
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={2}
                />
              )}
            </div>
          </div>
        </Panel>
        <Panel title="Pricing">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {field(
              `Base amount (${currency.toUpperCase()})`,
              <Input
                type="number"
                min={0}
                step="0.01"
                value={baseAmount}
                onChange={(event) => setBaseAmount(event.target.value)}
              />
            )}
            {field(
              "Billing period",
              <select
                className={selectClass}
                value={billingPeriod}
                onChange={(event) => setBillingPeriod(event.target.value)}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            )}
          </div>
        </Panel>
        <Panel
          title="Entitlements"
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setFeatures((items) => [
                  ...items,
                  {
                    key: "",
                    name: "",
                    type: "boolean",
                    limit: 1,
                    period: "none",
                  },
                ])
              }
            >
              Add feature
            </Button>
          }
        >
          {features.length ? (
            <div className="grid min-w-0 gap-2">
              {features.map((item, index) => (
                <div
                  key={index}
                  className="grid min-w-0 gap-2 rounded-md border p-3 lg:grid-cols-2 xl:grid-cols-4"
                >
                  {field(
                    "Key",
                    <Input
                      required
                      value={item.key}
                      onChange={(event) =>
                        changeFeature(index, "key", event.target.value)
                      }
                    />
                  )}
                  {field(
                    "Catalog",
                    <select
                      className={selectClass}
                      value={item.catalogId ?? ""}
                      onChange={(event) => {
                        const selected = catalog.data?.features.find(
                          (feature) => feature.id === event.target.value
                        )
                        setFeatures((items) =>
                          items.map((entry, at) =>
                            at === index
                              ? selected
                                ? {
                                    ...entry,
                                    catalogId: selected.id,
                                    key: selected.key,
                                    name: selected.name,
                                    type: selected.type,
                                    limit: selected.defaultLimit,
                                    period: selected.period,
                                    softLimit: selected.softLimit,
                                  }
                                : { ...entry, catalogId: "" }
                              : entry
                          )
                        )
                      }}
                    >
                      <option value="">Custom</option>
                      {catalog.data?.features
                        .filter((feature) => feature.status === "active")
                        .map((feature) => (
                          <option key={feature.id} value={feature.id}>
                            {feature.name}
                          </option>
                        ))}
                    </select>
                  )}
                  {field(
                    "Name",
                    <Input
                      required
                      value={item.name}
                      onChange={(event) =>
                        changeFeature(index, "name", event.target.value)
                      }
                    />
                  )}
                  {field(
                    "Type",
                    <select
                      className={selectClass}
                      value={item.type}
                      onChange={(event) =>
                        changeFeature(index, "type", event.target.value)
                      }
                    >
                      <option value="boolean">Boolean</option>
                      <option value="metered">Metered</option>
                      <option value="seat">Seat</option>
                    </select>
                  )}
                  {field(
                    "Limit",
                    <Input
                      type="number"
                      value={item.limit}
                      onChange={(event) =>
                        changeFeature(
                          index,
                          "limit",
                          Number(event.target.value)
                        )
                      }
                    />
                  )}
                  {field(
                    "Period",
                    <select
                      className={selectClass}
                      value={item.period || "none"}
                      onChange={(event) =>
                        changeFeature(index, "period", event.target.value)
                      }
                    >
                      <option value="none">None</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  )}
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!!item.softLimit}
                      onChange={(event) =>
                        changeFeature(index, "softLimit", event.target.checked)
                      }
                    />
                    Soft limit
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    aria-label={`Remove ${item.key || "feature"}`}
                    onClick={() =>
                      setFeatures((items) =>
                        items.filter((_, at) => at !== index)
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <ZeroState
              title="No entitlements"
              body="Add a feature to define what this plan includes."
              illustration={<CreditCard className="size-6" />}
              className="border-0 bg-transparent p-0"
            />
          )}
        </Panel>
        <Panel
          title="Usage pricing tiers"
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!features.some((item) => item.key)}
              onClick={() =>
                setTiers((items) => [
                  ...items,
                  {
                    featureKey: features.find((item) => item.key)?.key ?? "",
                    type: "graduated",
                    upTo: 0,
                    unitAmount: 0,
                    flatAmount: 0,
                  },
                ])
              }
            >
              Add tier
            </Button>
          }
        >
          {tiers.length ? (
            <div className="grid min-w-0 gap-2">
              {tiers.map((item, index) => (
                <div
                  key={index}
                  className="grid min-w-0 gap-2 rounded-md border p-3 lg:grid-cols-2 xl:grid-cols-[1fr_8rem_6rem_7rem_7rem_auto]"
                >
                  {field(
                    "Feature",
                    <select
                      className={selectClass}
                      value={item.featureKey}
                      onChange={(event) =>
                        changeTier(index, "featureKey", event.target.value)
                      }
                    >
                      {features
                        .filter((feature) => feature.key)
                        .map((feature) => (
                          <option key={feature.key} value={feature.key}>
                            {feature.name || feature.key}
                          </option>
                        ))}
                    </select>
                  )}
                  {field(
                    "Type",
                    <select
                      className={selectClass}
                      value={item.type}
                      onChange={(event) =>
                        changeTier(index, "type", event.target.value)
                      }
                    >
                      <option value="graduated">Graduated</option>
                      <option value="volume">Volume</option>
                      <option value="flat">Flat</option>
                    </select>
                  )}
                  {field(
                    "Up to",
                    <Input
                      type="number"
                      min={0}
                      value={item.upTo}
                      onChange={(event) =>
                        changeTier(index, "upTo", Number(event.target.value))
                      }
                    />
                  )}
                  {field(
                    "Unit amount",
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.unitAmount / currencyDivisor(currency)}
                      onChange={(event) =>
                        changeTier(
                          index,
                          "unitAmount",
                          Math.round(
                            Number(event.target.value) *
                              currencyDivisor(currency)
                          )
                        )
                      }
                    />
                  )}
                  {field(
                    "Flat amount",
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={item.flatAmount / currencyDivisor(currency)}
                      onChange={(event) =>
                        changeTier(
                          index,
                          "flatAmount",
                          Math.round(
                            Number(event.target.value) *
                              currencyDivisor(currency)
                          )
                        )
                      }
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    onClick={() =>
                      setTiers((items) => items.filter((_, at) => at !== index))
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No usage tiers. Base pricing applies to this plan.
            </p>
          )}
        </Panel>
        <div className="flex justify-end">
          <Button type="submit" disabled={command.loading}>
            {plan ? "Save plan" : "Create draft plan"}
          </Button>
        </div>
      </form>
    </section>
  )
}

export function PlanCreatePage() {
  return <PlanEditor />
}
export function PlanEditPage({ params }: PluginPageProps) {
  const query = useQuery<PlanDetail>("plans.detail", { id: params.id })
  if (!params.id)
    return (
      <ZeroState
        title="Plan not found"
        body="Select a plan to edit."
        illustration={<CreditCard className="size-6" />}
      />
    )
  return (
    <QueryBoundary title="Plan" query={query}>
      {(data) => <PlanEditor key={data.id} plan={data} />}
    </QueryBoundary>
  )
}

export function SubscriptionsPage() {
  const query = useQuery<SubscriptionsList>("subscriptions.all")
  const plans = useQuery<PlansList>("plans.list")
  const create = useCommand<Ack>("subscriptions.create")
  const change = useCommand<Ack>("subscriptions.change")
  const pause = useCommand<Ack>("subscriptions.pause")
  const resume = useCommand<Ack>("subscriptions.resume")
  const cancel = useCommand<Ack>("subscriptions.cancel")
  const [tenantId, setTenantId] = useState("")
  const [planId, setPlanId] = useState("")
  const [target, setTarget] = useState<{
    id: string
    action: "pause" | "resume" | "cancel"
  } | null>(null)
  const [changeTarget, setChangeTarget] = useState("")
  const [newPlanId, setNewPlanId] = useState("")
  const nameFor = (id: string) =>
    plans.data?.plans.find((item) => item.id === id)?.name ?? id
  const cmd =
    target?.action === "pause"
      ? pause
      : target?.action === "resume"
        ? resume
        : cancel
  async function add(event: FormEvent) {
    event.preventDefault()
    if ((await create.execute({ tenantId, planId }))?.ok) {
      setTenantId("")
      void query.refetch()
    }
  }
  const columns: Column<SubscriptionSummary>[] = [
    {
      id: "tenant",
      header: "Tenant",
      cell: (item) => (
        <PluginLink
          to={`/billing/subscriptions/${item.id}`}
          className="font-mono text-xs"
        >
          {item.tenantId}
        </PluginLink>
      ),
    },
    { id: "plan", header: "Plan", cell: (item) => nameFor(item.planId) },
    {
      id: "status",
      header: "Status",
      cell: (item) => (
        <Badge variant={item.status === "active" ? "default" : "secondary"}>
          {item.cancelAt ? "Cancel scheduled" : item.status}
        </Badge>
      ),
    },
    {
      id: "period",
      header: "Period end",
      cell: (item) =>
        item.currentPeriodEnd
          ? new Date(item.currentPeriodEnd).toLocaleDateString()
          : "None",
    },
  ]
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Subscriptions"
        description="Manage tenant subscriptions and lifecycle."
      />
      <Panel title="Create subscription">
        <form
          onSubmit={(event) => void add(event)}
          className="flex flex-wrap items-end gap-2"
        >
          <div className="min-w-40 flex-1">
            {field(
              "Tenant ID",
              <Input
                required
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
              />
            )}
          </div>
          <div className="min-w-40 flex-1">
            {field(
              "Plan",
              <select
                required
                className={selectClass}
                value={planId}
                onChange={(event) => setPlanId(event.target.value)}
              >
                <option value="">Select plan</option>
                {plans.data?.plans
                  .filter((item) => item.status === "active")
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
          <Button type="submit" disabled={create.loading}>
            Subscribe
          </Button>
        </form>
        <CommandAlert error={create.error} title="Could not complete action" />
      </Panel>
      <CommandAlert error={pause.error} title="Could not complete action" />
      <CommandAlert error={resume.error} title="Could not complete action" />
      <CommandAlert error={cancel.error} title="Could not complete action" />
      <CommandAlert error={change.error} title="Could not complete action" />
      <QueryBoundary title="Subscriptions" query={query}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.subscriptions ?? []}
            rowKey={(item) => item.id}
            caption={`${data.subscriptions?.length ?? 0} subscriptions`}
            emptyMessage="No subscriptions yet."
            rowActions={(item) => (
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setChangeTarget(item.id)
                    setNewPlanId(item.planId)
                  }}
                >
                  Change plan
                </Button>
                {item.status === "paused" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ id: item.id, action: "resume" })}
                  >
                    Resume
                  </Button>
                ) : item.status === "active" || item.status === "trialing" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ id: item.id, action: "pause" })}
                  >
                    Pause
                  </Button>
                ) : null}
                {item.status !== "canceled" && !item.cancelAt && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => setTarget({ id: item.id, action: "cancel" })}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            )}
          />
        )}
      </QueryBoundary>
      {changeTarget && (
        <Panel
          title="Change plan"
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setChangeTarget("")}
            >
              Close
            </Button>
          }
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              {field(
                "New plan",
                <select
                  className={selectClass}
                  value={newPlanId}
                  onChange={(event) => setNewPlanId(event.target.value)}
                >
                  {plans.data?.plans
                    .filter((item) => item.status === "active")
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <Button
              disabled={change.loading || !newPlanId}
              onClick={() =>
                void change
                  .execute({ id: changeTarget, planId: newPlanId })
                  .then((result) => {
                    if (result?.ok) {
                      setChangeTarget("")
                      void query.refetch()
                    }
                  })
              }
            >
              Apply plan
            </Button>
          </div>
        </Panel>
      )}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`${target?.action ?? "Update"} subscription?`}
        description={
          target?.action === "cancel"
            ? "The subscription will end at the current period's close."
            : "This changes the subscription status."
        }
        confirmLabel={target?.action ?? "Confirm"}
        destructive={target?.action === "cancel"}
        pending={cmd.loading}
        onConfirm={() => {
          if (target)
            void cmd
              .execute({ id: target.id, immediately: false })
              .then((result) => {
                if (result?.ok) {
                  setTarget(null)
                  void query.refetch()
                }
              })
        }}
      />
    </section>
  )
}

export function InvoicesPage() {
  const query = useQuery<{ invoices: Invoice[] }>("invoices.list")
  const subs = useQuery<SubscriptionsList>("subscriptions.all")
  const generate = useCommand<Ack>("invoices.generate")
  const paid = useCommand<Ack>("invoices.markPaid")
  const voidInvoice = useCommand<Ack>("invoices.void")
  const [subId, setSubId] = useState("")
  const [target, setTarget] = useState<{
    invoice: Invoice
    action: "paid" | "void"
  } | null>(null)
  const [paymentRef, setPaymentRef] = useState("")
  const [reason, setReason] = useState("")
  const cmd = target?.action === "paid" ? paid : voidInvoice
  const columns: Column<Invoice>[] = [
    {
      id: "id",
      header: "Invoice",
      cell: (item) => (
        <PluginLink
          to={`/billing/invoices/${item.id}`}
          className="font-mono text-xs"
        >
          {item.id}
        </PluginLink>
      ),
    },
    { id: "tenant", header: "Tenant", cell: (item) => item.tenantId },
    {
      id: "total",
      header: "Total",
      cell: (item) => money(item.total, item.currency),
    },
    {
      id: "status",
      header: "Status",
      cell: (item) => (
        <Badge variant={item.status === "paid" ? "default" : "secondary"}>
          {item.status}
        </Badge>
      ),
    },
    {
      id: "reference",
      header: "Payment reference",
      cell: (item) => item.paymentRef || "None",
    },
  ]
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Invoices"
        description="Review charges and record payment outcomes."
      />
      <Panel title="Generate invoice">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            {field(
              "Subscription",
              <select
                className={selectClass}
                value={subId}
                onChange={(event) => setSubId(event.target.value)}
              >
                <option value="">Select subscription</option>
                {subs.data?.subscriptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.tenantId} · {item.id}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button
            disabled={!subId || generate.loading}
            onClick={() =>
              void generate
                .execute({ subscriptionId: subId })
                .then((result) => {
                  if (result?.ok) void query.refetch()
                })
            }
          >
            Generate
          </Button>
        </div>
        <CommandAlert
          error={generate.error}
          title="Could not complete action"
        />
      </Panel>
      <CommandAlert error={paid.error} title="Could not complete action" />
      <CommandAlert
        error={voidInvoice.error}
        title="Could not complete action"
      />
      <QueryBoundary title="Invoices" query={query}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.invoices ?? []}
            rowKey={(item) => item.id}
            caption={`${data.invoices?.length ?? 0} invoices`}
            emptyMessage="No invoices yet."
            rowActions={(item) =>
              item.status === "paid" || item.status === "voided" ? null : (
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ invoice: item, action: "paid" })}
                  >
                    Mark paid
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ invoice: item, action: "void" })}
                  >
                    Void
                  </Button>
                </div>
              )
            }
          />
        )}
      </QueryBoundary>
      {target && (
        <Panel
          title={`${target.action === "paid" ? "Mark paid" : "Void"} ${target.invoice.id}`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
              Close
            </Button>
          }
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              {target.action === "paid"
                ? field(
                    "Payment reference",
                    <Input
                      required
                      value={paymentRef}
                      onChange={(event) => setPaymentRef(event.target.value)}
                    />
                  )
                : field(
                    "Reason",
                    <Input
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  )}
            </div>
            <Button
              disabled={
                cmd.loading || (target.action === "paid" && !paymentRef.trim())
              }
              onClick={() =>
                void cmd
                  .execute({ id: target.invoice.id, paymentRef, reason })
                  .then((result) => {
                    if (result?.ok) {
                      setTarget(null)
                      setPaymentRef("")
                      setReason("")
                      void query.refetch()
                    }
                  })
              }
            >
              Confirm
            </Button>
          </div>
        </Panel>
      )}
    </section>
  )
}

export function CouponsPage() {
  const query = useQuery<{ coupons: Coupon[] }>("coupons.list")
  const create = useCommand<Ack>("coupons.create")
  const remove = useCommand<Ack>("coupons.delete")
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [type, setType] = useState("percentage")
  const [value, setValue] = useState("")
  const [currency, setCurrency] = useState("usd")
  const [maxRedemptions, setMaxRedemptions] = useState(0)
  const [validFrom, setValidFrom] = useState("")
  const [validUntil, setValidUntil] = useState("")
  const [target, setTarget] = useState<Coupon | null>(null)
  async function add(event: FormEvent) {
    event.preventDefault()
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return
    if (
      (
        await create.execute({
          code,
          name,
          type,
          percentage: type === "percentage" ? numeric : 0,
          amount:
            type === "amount"
              ? Math.round(numeric * currencyDivisor(currency))
              : 0,
          currency,
          maxRedemptions,
          validFrom,
          validUntil,
        })
      )?.ok
    ) {
      setCode("")
      setName("")
      setValue("")
      setMaxRedemptions(0)
      setValidFrom("")
      setValidUntil("")
      void query.refetch()
    }
  }
  const columns: Column<Coupon>[] = [
    {
      id: "code",
      header: "Code",
      cell: (item) => (
        <span className="font-mono font-medium">{item.code}</span>
      ),
    },
    { id: "name", header: "Name", cell: (item) => item.name },
    {
      id: "value",
      header: "Discount",
      cell: (item) =>
        item.type === "percentage"
          ? `${item.percentage}%`
          : money(item.amount, item.currency),
    },
    {
      id: "uses",
      header: "Redeemed",
      cell: (item) =>
        `${item.timesRedeemed}${item.maxRedemptions ? ` / ${item.maxRedemptions}` : ""}`,
    },
    {
      id: "expires",
      header: "Expires",
      cell: (item) => item.validUntil || "No expiry",
    },
  ]
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Coupons"
        description="Manage subscription discount codes."
      />
      <Panel title="Create coupon">
        <form
          onSubmit={(event) => void add(event)}
          className="grid min-w-0 gap-2 lg:grid-cols-3 lg:items-end xl:grid-cols-6"
        >
          {field(
            "Code",
            <Input
              required
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          )}
          {field(
            "Name",
            <Input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
          {field(
            "Type",
            <select
              className={selectClass}
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="percentage">Percent</option>
              <option value="amount">Amount</option>
            </select>
          )}
          {field(
            "Value",
            <Input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          {field(
            "Currency",
            <Input
              disabled={type === "percentage"}
              maxLength={3}
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value.toLowerCase())
              }
            />
          )}
          {field(
            "Max redemptions",
            <Input
              type="number"
              min={0}
              value={maxRedemptions}
              onChange={(event) =>
                setMaxRedemptions(Number(event.target.value))
              }
            />
          )}
          {field(
            "Valid from",
            <Input
              type="date"
              value={validFrom}
              onChange={(event) => setValidFrom(event.target.value)}
            />
          )}
          {field(
            "Valid until",
            <Input
              type="date"
              min={validFrom || undefined}
              value={validUntil}
              onChange={(event) => setValidUntil(event.target.value)}
            />
          )}
          <Button type="submit" disabled={create.loading}>
            Create
          </Button>
        </form>
        <CommandAlert error={create.error} title="Could not complete action" />
      </Panel>
      <CommandAlert error={remove.error} title="Could not complete action" />
      <QueryBoundary title="Coupons" query={query}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.coupons ?? []}
            rowKey={(item) => item.id}
            caption={`${data.coupons?.length ?? 0} coupons`}
            emptyMessage="No coupons yet."
            rowActions={(item) => (
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setTarget(item)}
              >
                Delete
              </Button>
            )}
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`Delete ${target?.code ?? "coupon"}?`}
        description="This code will no longer be available for new redemptions."
        confirmLabel="Delete coupon"
        destructive
        pending={remove.loading}
        onConfirm={() => {
          if (target)
            void remove.execute({ id: target.id }).then((result) => {
              if (result?.ok) {
                setTarget(null)
                void query.refetch()
              }
            })
        }}
      />
    </section>
  )
}

export function BillingFeaturesPage() {
  const query = useQuery<{ features: CatalogFeature[] }>("features.list")
  const create = useCommand<Ack>("features.create")
  const update = useCommand<Ack>("features.update")
  const archive = useCommand<Ack>("features.archive")
  const [editing, setEditing] = useState<CatalogFeature | null>(null)
  const [key, setKey] = useState("")
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [type, setType] = useState("boolean")
  const [defaultLimit, setDefaultLimit] = useState(1)
  const [period, setPeriod] = useState("none")
  const [softLimit, setSoftLimit] = useState(false)
  const [target, setTarget] = useState<CatalogFeature | null>(null)
  const command = editing ? update : create
  function select(item: CatalogFeature | null) {
    setEditing(item)
    setKey(item?.key ?? "")
    setName(item?.name ?? "")
    setDescription(item?.description ?? "")
    setType(item?.type ?? "boolean")
    setDefaultLimit(item?.defaultLimit ?? 1)
    setPeriod(item?.period || "none")
    setSoftLimit(item?.softLimit ?? false)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (
      (
        await command.execute({
          id: editing?.id,
          key,
          name,
          description,
          type,
          defaultLimit,
          period,
          softLimit,
        })
      )?.ok
    ) {
      select(null)
      void query.refetch()
    }
  }
  const columns: Column<CatalogFeature>[] = [
    {
      id: "key",
      header: "Key",
      cell: (item) => <span className="font-mono text-xs">{item.key}</span>,
    },
    { id: "name", header: "Name", cell: (item) => item.name },
    {
      id: "type",
      header: "Type",
      cell: (item) => <Badge variant="outline">{item.type}</Badge>,
    },
    { id: "limit", header: "Default limit", cell: (item) => item.defaultLimit },
    {
      id: "status",
      header: "Status",
      cell: (item) => (
        <Badge variant={item.status === "active" ? "default" : "secondary"}>
          {item.status}
        </Badge>
      ),
    },
  ]
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Feature catalog"
        description="Define reusable entitlements for billing plans."
      />
      <Panel
        title={editing ? `Edit ${editing.name}` : "New catalog feature"}
        actions={
          editing && (
            <Button size="sm" variant="ghost" onClick={() => select(null)}>
              Cancel edit
            </Button>
          )
        }
      >
        <form
          onSubmit={(event) => void save(event)}
          className="grid min-w-0 gap-3"
        >
          <div className="grid min-w-0 gap-2 lg:grid-cols-3">
            {field(
              "Key",
              <Input
                required
                disabled={!!editing}
                value={key}
                onChange={(event) => setKey(event.target.value)}
              />
            )}
            {field(
              "Name",
              <Input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            )}
            {field(
              "Type",
              <select
                className={selectClass}
                value={type}
                onChange={(event) => setType(event.target.value)}
              >
                <option value="boolean">Boolean</option>
                <option value="metered">Metered</option>
                <option value="seat">Seat</option>
              </select>
            )}
            {field(
              "Default limit",
              <Input
                type="number"
                value={defaultLimit}
                onChange={(event) =>
                  setDefaultLimit(Number(event.target.value))
                }
              />
            )}
            {field(
              "Period",
              <select
                className={selectClass}
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              >
                <option value="none">None</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            )}
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={softLimit}
                onChange={(event) => setSoftLimit(event.target.checked)}
              />
              Soft limit
            </label>
          </div>
          {field(
            "Description",
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={command.loading}>
              {editing ? "Save feature" : "Create feature"}
            </Button>
          </div>
        </form>
        <CommandAlert error={command.error} title="Could not save feature" />
      </Panel>
      <CommandAlert error={archive.error} title="Could not archive feature" />
      <QueryBoundary title="Feature catalog" query={query}>
        {(data) => (
          <ResourceTable
            columns={columns}
            rows={data.features ?? []}
            rowKey={(item) => item.id}
            caption={`${data.features?.length ?? 0} features`}
            emptyMessage="No catalog features yet."
            rowActions={(item) => (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => select(item)}
                >
                  Edit
                </Button>
                {item.status !== "archived" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget(item)}
                  >
                    Archive
                  </Button>
                )}
              </div>
            )}
          />
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`Archive ${target?.name ?? "feature"}?`}
        description="Archived features stay on existing plans but cannot be selected for new ones."
        confirmLabel="Archive feature"
        pending={archive.loading}
        onConfirm={() => {
          if (target)
            void archive.execute({ id: target.id }).then((result) => {
              if (result?.ok) {
                setTarget(null)
                void query.refetch()
              }
            })
        }}
      />
    </section>
  )
}

export function SubscriptionDetailPage({ params }: PluginPageProps) {
  const id = params.id ?? ""
  const query = useQuery<SubscriptionDetail>("subscriptions.detail", { id })
  const plans = useQuery<PlansList>("plans.list")
  const change = useCommand<Ack>("subscriptions.change")
  const pause = useCommand<Ack>("subscriptions.pause")
  const resume = useCommand<Ack>("subscriptions.resume")
  const cancel = useCommand<Ack>("subscriptions.cancel")
  const [planId, setPlanId] = useState("")
  const [target, setTarget] = useState<"pause" | "resume" | "cancel" | null>(
    null
  )
  const cmd = target === "pause" ? pause : target === "resume" ? resume : cancel
  if (!id)
    return (
      <ZeroState
        title="Subscription not found"
        body="Select a subscription from billing."
        illustration={<CreditCard className="size-6" />}
      />
    )
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <QueryBoundary title="Subscription" query={query}>
        {(item) => (
          <>
            <PageHeader
              title={item.planName || item.planId}
              description={`Subscription for ${item.tenantId}`}
              actions={
                <PageLink to="/billing/subscriptions">
                  All subscriptions
                </PageLink>
              }
            />
            <CommandAlert
              error={
                change.error ?? pause.error ?? resume.error ?? cancel.error
              }
              title="Could not update subscription"
            />
            <Panel title="Overview">
              <DescriptionList
                items={[
                  {
                    term: "Subscription ID",
                    value: <span className="font-mono text-xs">{item.id}</span>,
                  },
                  { term: "Tenant", value: item.tenantId },
                  {
                    term: "Status",
                    value: (
                      <Badge
                        variant={
                          item.status === "active" ? "default" : "secondary"
                        }
                      >
                        {item.cancelAt ? "Cancel scheduled" : item.status}
                      </Badge>
                    ),
                  },
                  { term: "Plan", value: item.planName || item.planId },
                  {
                    term: "Current period",
                    value: `${item.currentPeriodStart?.slice(0, 10) ?? ""} to ${item.currentPeriodEnd?.slice(0, 10) ?? ""}`,
                  },
                ]}
              />
            </Panel>
            <Panel title="Manage subscription">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  {field(
                    "Change plan",
                    <select
                      className={selectClass}
                      value={planId || item.planId}
                      onChange={(event) => setPlanId(event.target.value)}
                    >
                      {plans.data?.plans
                        .filter((plan) => plan.status === "active")
                        .map((plan) => (
                          <option key={plan.id} value={plan.id}>
                            {plan.name}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <Button
                  variant="outline"
                  disabled={change.loading || !planId || planId === item.planId}
                  onClick={() =>
                    void change.execute({ id, planId }).then((result) => {
                      if (result?.ok) void query.refetch()
                    })
                  }
                >
                  Apply plan
                </Button>
                {item.status === "paused" ? (
                  <Button variant="outline" onClick={() => setTarget("resume")}>
                    Resume
                  </Button>
                ) : item.status === "active" || item.status === "trialing" ? (
                  <Button variant="outline" onClick={() => setTarget("pause")}>
                    Pause
                  </Button>
                ) : null}
                {item.status !== "canceled" && !item.cancelAt && (
                  <Button
                    variant="destructive"
                    onClick={() => setTarget("cancel")}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </Panel>
            <Panel title="Usage">
              <ResourceTable
                columns={[
                  {
                    id: "feature",
                    header: "Feature",
                    cell: (row) => row.featureName || row.featureKey,
                  },
                  { id: "used", header: "Used", cell: (row) => row.used },
                  {
                    id: "limit",
                    header: "Limit",
                    cell: (row) => (row.limit < 0 ? "Unlimited" : row.limit),
                  },
                  {
                    id: "remaining",
                    header: "Remaining",
                    cell: (row) =>
                      row.remaining < 0 ? "Unlimited" : row.remaining,
                  },
                ]}
                rows={item.usage ?? []}
                rowKey={(row) => row.featureKey}
                caption="Feature usage"
                emptyMessage="No usage data for this subscription."
              />
            </Panel>
            <Panel title="Invoices">
              <ResourceTable
                columns={[
                  {
                    id: "id",
                    header: "Invoice",
                    cell: (row) => (
                      <PluginLink to={`/billing/invoices/${row.id}`}>
                        {row.id}
                      </PluginLink>
                    ),
                  },
                  {
                    id: "total",
                    header: "Total",
                    cell: (row) => money(row.total, row.currency),
                  },
                  { id: "status", header: "Status", cell: (row) => row.status },
                ]}
                rows={item.invoices ?? []}
                rowKey={(row) => row.id}
                caption="Subscription invoices"
                emptyMessage="No invoices for this subscription."
              />
            </Panel>
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`${target ?? "Update"} subscription?`}
        description={
          target === "cancel"
            ? "The subscription will end at the current period's close."
            : "This changes the subscription status."
        }
        confirmLabel={target ?? "Confirm"}
        destructive={target === "cancel"}
        pending={cmd.loading}
        onConfirm={() =>
          void cmd.execute({ id, immediately: false }).then((result) => {
            if (result?.ok) {
              setTarget(null)
              void query.refetch()
            }
          })
        }
      />
    </section>
  )
}

export function InvoiceDetailPage({ params }: PluginPageProps) {
  const id = params.id ?? ""
  const query = useQuery<InvoiceDetail>("invoices.detail", { id })
  const paid = useCommand<Ack>("invoices.markPaid")
  const voidInvoice = useCommand<Ack>("invoices.void")
  const [paymentRef, setPaymentRef] = useState("")
  const [reason, setReason] = useState("")
  const [confirmVoid, setConfirmVoid] = useState(false)
  if (!id)
    return (
      <ZeroState
        title="Invoice not found"
        body="Select an invoice from billing."
        illustration={<CreditCard className="size-6" />}
      />
    )
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <QueryBoundary title="Invoice" query={query}>
        {(item) => (
          <>
            <PageHeader
              title={`Invoice ${item.id}`}
              description={`${money(item.total, item.currency)} · ${item.status}`}
              actions={<PageLink to="/billing/invoices">All invoices</PageLink>}
            />
            <CommandAlert
              error={paid.error ?? voidInvoice.error}
              title="Could not update invoice"
            />
            <Panel title="Invoice details">
              <DescriptionList
                items={[
                  { term: "Tenant", value: item.tenantId },
                  {
                    term: "Subscription",
                    value: (
                      <PluginLink
                        to={`/billing/subscriptions/${item.subscriptionId}`}
                      >
                        {item.subscriptionId}
                      </PluginLink>
                    ),
                  },
                  {
                    term: "Status",
                    value: (
                      <Badge
                        variant={
                          item.status === "paid" ? "default" : "secondary"
                        }
                      >
                        {item.status}
                      </Badge>
                    ),
                  },
                  {
                    term: "Period",
                    value: `${item.periodStart} to ${item.periodEnd}`,
                  },
                  {
                    term: "Subtotal",
                    value: money(item.subtotal, item.currency),
                  },
                  { term: "Tax", value: money(item.taxAmount, item.currency) },
                  {
                    term: "Discount",
                    value: money(item.discountAmount, item.currency),
                  },
                  { term: "Total", value: money(item.total, item.currency) },
                  {
                    term: "Payment reference",
                    value: item.paymentRef || "None",
                  },
                ]}
              />
            </Panel>
            <Panel title="Line items">
              <ResourceTable
                columns={[
                  {
                    id: "description",
                    header: "Description",
                    cell: (line) => line.description,
                  },
                  { id: "type", header: "Type", cell: (line) => line.type },
                  {
                    id: "quantity",
                    header: "Quantity",
                    cell: (line) => line.quantity,
                  },
                  {
                    id: "unit",
                    header: "Unit",
                    cell: (line) => money(line.unitAmount, item.currency),
                  },
                  {
                    id: "amount",
                    header: "Amount",
                    cell: (line) => money(line.amount, item.currency),
                  },
                ]}
                rows={item.lineItems ?? []}
                rowKey={(line) =>
                  `${line.description}-${line.type}-${line.featureKey ?? ""}`
                }
                caption="Invoice line items"
                emptyMessage="No line items."
              />
            </Panel>
            {item.status !== "paid" && item.status !== "voided" && (
              <Panel title="Record outcome">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      {field(
                        "Payment reference",
                        <Input
                          value={paymentRef}
                          onChange={(event) =>
                            setPaymentRef(event.target.value)
                          }
                        />
                      )}
                    </div>
                    <Button
                      disabled={!paymentRef.trim() || paid.loading}
                      onClick={() =>
                        void paid.execute({ id, paymentRef }).then((result) => {
                          if (result?.ok) void query.refetch()
                        })
                      }
                    >
                      Mark paid
                    </Button>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                      {field(
                        "Void reason",
                        <Input
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                        />
                      )}
                    </div>
                    <Button
                      variant="outline"
                      disabled={voidInvoice.loading}
                      onClick={() => setConfirmVoid(true)}
                    >
                      Void
                    </Button>
                  </div>
                </div>
              </Panel>
            )}
          </>
        )}
      </QueryBoundary>
      <ConfirmDialog
        open={confirmVoid}
        onOpenChange={setConfirmVoid}
        title="Void invoice?"
        description="This invoice will be marked void and cannot be paid."
        confirmLabel="Void invoice"
        destructive
        pending={voidInvoice.loading}
        onConfirm={() =>
          void voidInvoice.execute({ id, reason }).then((result) => {
            if (result?.ok) {
              setConfirmVoid(false)
              void query.refetch()
            }
          })
        }
      />
    </section>
  )
}
