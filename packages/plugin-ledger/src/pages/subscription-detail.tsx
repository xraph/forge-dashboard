import { useState } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { SubscriptionStatusBadge } from "../badges"
import { ConfirmAction } from "../components/confirm-action"
import { EntitlementPanel } from "../components/entitlement-panel"
import { invoiceColumns } from "../components/invoice-columns"
import { isNotFound, NotFoundState } from "../components/not-found"
import { SyncPanel } from "../components/sync-panel"
import { describeDiscount } from "../lib/coupons"
import { formatDay, formatPeriod } from "../lib/datetime"
import { couponPath, invoicePath, planPath } from "../lib/paths"
import type { Coupon, Invoice, Page, Plan, Subscription, SubscriptionDetail, SubscriptionStatus } from "../types"

export type SubscriptionAction = "generate" | "changePlan" | "applyCoupon" | "pause" | "resume" | "cancel"

/**
 * The actions the engine allows from each state, so the page never offers a
 * button that promises a refusal.
 *
 * Checked against the engine. Pause takes active and trialing only, resume
 * takes paused only, and cancel and change-plan refuse only a canceled or
 * expired subscription, so a past-due or paused one can still be cancelled or
 * moved. The engine puts no status rule on generating an invoice or applying a
 * coupon; the page withholds both from a paused or finished subscription all
 * the same, because billing or discounting one that is not running is not
 * something to invite.
 */
export function legalActions(status: SubscriptionStatus): SubscriptionAction[] {
  switch (status) {
    case "active":
    case "trialing":
      return ["generate", "changePlan", "applyCoupon", "pause", "cancel"]
    case "past_due":
      return ["generate", "changePlan", "applyCoupon", "cancel"]
    case "paused":
      return ["changePlan", "resume", "cancel"]
    default:
      return []
  }
}

const INVOICE_READ = 200

export function LedgerSubscriptionDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No subscription id in the address, so there is nothing to show.
      </p>
    )
  }
  return <SubscriptionDetailBody id={id} />
}

function SubscriptionDetailBody({ id }: { id: string }) {
  const detail = useQuery<SubscriptionDetail>("subscriptions.detail", { id })
  // Once there is data the page stays up through a refresh: a write
  // invalidates subscriptions.detail, and QueryBoundary would otherwise swap
  // the page for a skeleton and take any open dialog with it.
  if (detail.data !== undefined) return <SubscriptionDetailView detail={detail.data} />
  if (isNotFound(detail.error, "subscription")) {
    return <NotFoundState noun="subscription" id={id} backTo="/subscriptions" backLabel="Back to subscriptions" />
  }
  return (
    <QueryBoundary title="Subscription" query={detail} skeletonRows={6}>
      {(d) => <SubscriptionDetailView detail={d} />}
    </QueryBoundary>
  )
}

type Dialog = "pause" | "resume" | "cancel" | "changePlan" | "applyCoupon" | null

function SubscriptionDetailView({ detail }: { detail: SubscriptionDetail }) {
  const { subscription: sub, plan } = detail
  const coupons = detail.applied_coupons ?? []
  const actions = legalActions(sub.status)
  const navigate = useNavigateTo()
  const pause = useCommand<Subscription>("subscriptions.pause")
  const resume = useCommand<Subscription>("subscriptions.resume")
  const cancel = useCommand<Subscription>("subscriptions.cancel")
  const applyCoupon = useCommand<Coupon>("coupons.apply")
  const generate = useCommand<Invoice>("invoices.generate")
  const [dialog, setDialog] = useState<Dialog>(null)
  const [immediately, setImmediately] = useState(false)
  const [code, setCode] = useState("")

  function openDialog(which: Exclude<Dialog, null>) {
    // Reset at open, and clear what the dialog collects, so nothing from an
    // earlier attempt is shown against this one. The plan-change dialog owns
    // its command and its choices and is mounted only while open, so it starts
    // clean on its own.
    if (which !== "changePlan") ({ pause, resume, cancel, applyCoupon })[which].reset()
    setImmediately(false)
    setCode("")
    setDialog(which)
  }

  async function generateInvoice() {
    const result = await generate.execute({ subscription_id: sub.id })
    if (result !== undefined) navigate(invoicePath(result.id))
  }

  const close = (o: boolean) => !o && setDialog(null)
  const seatText = Object.entries(sub.quantity ?? {}).map(([k, n]) => `${k}: ${n}`)

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={`${sub.tenant_id} on ${plan.name}`}
        actions={
          actions.length > 0 && (
            <>
              {actions.includes("generate") && (
                <Button variant="outline" disabled={generate.loading} onClick={() => void generateInvoice()}>
                  {generate.loading ? "Generating…" : "Generate invoice"}
                </Button>
              )}
              {actions.includes("changePlan") && (
                <Button variant="outline" onClick={() => openDialog("changePlan")}>
                  Change plan
                </Button>
              )}
              {actions.includes("applyCoupon") && (
                <Button variant="outline" onClick={() => openDialog("applyCoupon")}>
                  Apply coupon
                </Button>
              )}
              {actions.includes("pause") && (
                <Button variant="outline" onClick={() => openDialog("pause")}>
                  Pause
                </Button>
              )}
              {actions.includes("resume") && (
                <Button variant="outline" onClick={() => openDialog("resume")}>
                  Resume
                </Button>
              )}
              {actions.includes("cancel") && (
                <Button variant="destructive" onClick={() => openDialog("cancel")}>
                  Cancel subscription
                </Button>
              )}
            </>
          )
        }
      />
      <CommandAlert error={generate.error} title="Could not generate an invoice" />

      <DetailLayout
        main={
          <>
            <EntitlementPanel subscriptionId={sub.id} />
            <SubscriptionInvoices subscription={sub} />
          </>
        }
        aside={
          <>
            <DescriptionList
              items={[
                { term: "Status", value: <SubscriptionStatusBadge status={sub.status} /> },
                { term: "Plan", value: <PluginLink to={planPath(plan.id)}>{plan.name}</PluginLink> },
                { term: "Tenant", value: <span className="font-mono text-xs">{sub.tenant_id}</span> },
                { term: "Current period", value: formatPeriod(sub.current_period_start, sub.current_period_end) },
                {
                  term: "Trial",
                  value: sub.trial_start && sub.trial_end ? formatPeriod(sub.trial_start, sub.trial_end) : <NoneCell label="trial" />,
                },
                {
                  // The engine never writes ended_at: cancelling always sets
                  // cancel_at, and sets canceled_at as well only when the end
                  // has already arrived.
                  term: sub.status === "canceled" ? "Canceled" : "Cancels",
                  value: <Timestamp value={sub.status === "canceled" ? sub.canceled_at : sub.cancel_at} label="scheduled cancellation" />,
                },
                { term: "Seats", value: seatText.length > 0 ? <span className="font-mono text-xs">{seatText.join(", ")}</span> : <NoneCell label="seat counts" /> },
                { term: "Started", value: <Timestamp value={sub.created_at} label="start" /> },
              ]}
            />
            <section className="flex flex-col gap-2" aria-label="Applied coupons">
              <h2 className="text-sm font-medium">Coupons</h2>
              {coupons.length === 0 ? (
                <NoneCell label="applied coupons" />
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {coupons.map((c) => (
                    <li key={c.id} className="flex items-baseline justify-between gap-2">
                      <PluginLink to={couponPath(c.id)} className="font-mono text-xs">
                        {c.code}
                      </PluginLink>
                      <span className="tabular-nums text-muted-foreground">{describeDiscount(c)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <SyncPanel intent="subscriptions.syncToProvider" id={sub.id} providerName={sub.provider_name} providerId={sub.provider_id} />
          </>
        }
      />

      <ConfirmAction
        open={dialog === "pause"}
        onOpenChange={close}
        title={`Pause ${sub.tenant_id}'s subscription?`}
        description="Entitlement checks refuse while it is paused. Resume it to restore access."
        confirmLabel="Pause subscription"
        command={pause}
        payload={{ id: sub.id }}
        onDone={() => setDialog(null)}
      />
      <ConfirmAction
        open={dialog === "resume"}
        onOpenChange={close}
        title={`Resume ${sub.tenant_id}'s subscription?`}
        description="It becomes active again straight away."
        confirmLabel="Resume subscription"
        command={resume}
        payload={{ id: sub.id }}
        onDone={() => setDialog(null)}
      />
      <ConfirmAction
        open={dialog === "cancel"}
        onOpenChange={close}
        title={`Cancel ${sub.tenant_id}'s subscription?`}
        description={
          <span className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" name="cancel-when" checked={!immediately} onChange={() => setImmediately(false)} />
              {`At the end of the current period, ${formatDay(sub.current_period_end)}`}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="cancel-when" checked={immediately} onChange={() => setImmediately(true)} />
              End it now
            </label>
            <span>A canceled subscription cannot be restarted. The tenant would need a new one.</span>
          </span>
        }
        confirmLabel="Cancel it"
        destructive
        command={cancel}
        payload={{ id: sub.id, immediately }}
        onDone={() => setDialog(null)}
      />
      <ConfirmAction
        open={dialog === "applyCoupon"}
        onOpenChange={close}
        title={`Apply a coupon to ${sub.tenant_id}'s subscription`}
        description={
          <span className="flex flex-col gap-1.5">
            <Label htmlFor="apply-code">Coupon code</Label>
            {/* No uppercase style: the engine matches a code exactly, so the field must show what it sends. */}
            <Input
              id="apply-code"
              aria-describedby="apply-code-help"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <span id="apply-code-help">It applies from the next invoice. Invoices already issued are not changed.</span>
          </span>
        }
        confirmLabel="Apply"
        command={applyCoupon}
        payload={{ subscription_id: sub.id, code: code.trim() }}
        confirmDisabled={code.trim() === ""}
        onDone={() => setDialog(null)}
      />
      {/* Mounted only while open: it reads the plan list, and useQuery fires on mount. */}
      {dialog === "changePlan" && <ChangePlanDialog subscription={sub} current={plan} onClose={() => setDialog(null)} />}
    </section>
  )
}

/**
 * Moves the subscription to another active plan.
 *
 * It sends no quantity unless it has to, and the engine reads an absent
 * quantity as "keep the current seat counts" and checks them against the new
 * plan. That check refuses a count for a key the plan has no seat feature for,
 * so the dialog works that out from the plan list first. When some counts have
 * nowhere to go it says which and waits for the operator to choose to clear
 * them, then sends the counts that do fit. It never drops a count on its own.
 */
function ChangePlanDialog({ subscription: sub, current, onClose }: { subscription: Subscription; current: Plan; onClose: () => void }) {
  const changePlan = useCommand<Subscription>("subscriptions.changePlan")
  const plans = useQuery<Page<Plan>>("plans.list", { status: "active", limit: 200, offset: 0 })
  const [newPlan, setNewPlan] = useState("")
  const [clear, setClear] = useState(false)
  const choices = (plans.data?.items ?? []).filter((p) => p.id !== current.id)
  const target = choices.find((p) => p.id === newPlan)

  const seatKeys = new Set((target?.features ?? []).filter((f) => f.type === "seat").map((f) => f.key))
  const carried = Object.entries(sub.quantity ?? {})
  const stranded = target ? carried.filter(([key]) => !seatKeys.has(key)).map(([key]) => key) : []

  const payload: Record<string, unknown> = { id: sub.id, plan_id: newPlan }
  if (stranded.length > 0 && clear) payload.quantity = Object.fromEntries(carried.filter(([key]) => seatKeys.has(key)))

  return (
    <ConfirmAction
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Move ${sub.tenant_id} to another plan`}
      description={
        <span className="flex flex-col gap-1.5">
          <Label htmlFor="change-plan">New plan</Label>
          {/* A bare select, not the kit's NativeSelect: that wraps the select in a div, and a dialog description is a paragraph. */}
          <select
            id="change-plan"
            aria-describedby="change-plan-help"
            className="h-7 w-full rounded-md border border-input bg-input/20 px-2 text-xs/relaxed outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
            value={newPlan}
            onChange={(e) => {
              setNewPlan(e.target.value)
              setClear(false)
            }}
            disabled={plans.loading}
          >
            <option value="">{plans.loading ? "Loading plans…" : "Choose a plan"}</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id} className="bg-[Canvas] text-[CanvasText]">
                {p.name}
              </option>
            ))}
          </select>
          <span id="change-plan-help">Seat counts carry over. The change is not prorated: the next invoice bills the new plan for the whole period.</span>
          {target && stranded.length > 0 && (
            <>
              <span>{`${target.name} has no seat feature for ${stranded.join(", ")}, so those seat counts cannot carry over.`}</span>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
                {`Clear the seat counts for ${stranded.join(", ")}`}
              </label>
            </>
          )}
          {plans.error && <CommandAlert error={plans.error} title="Could not load the plans" />}
        </span>
      }
      confirmLabel="Change plan"
      command={changePlan}
      payload={payload}
      confirmDisabled={newPlan === "" || (stranded.length > 0 && !clear)}
      onDone={onClose}
    />
  )
}

/**
 * This subscription's invoices. invoices.list filters by tenant, not by
 * subscription, so this reads the tenant's newest 200 and keeps the ones for
 * this subscription. A tenant with more than that is told where the rest are.
 */
function SubscriptionInvoices({ subscription }: { subscription: Subscription }) {
  const list = useQuery<Page<Invoice>>("invoices.list", { tenant_id: subscription.tenant_id, limit: INVOICE_READ, offset: 0 })
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">Invoices</h2>
      <QueryBoundary title="Invoices" query={list} skeletonRows={3}>
        {(data) => {
          const rows = (data.items ?? []).filter((i) => i.subscription_id === subscription.id)
          return (
            <>
              <ResourceTable<Invoice>
                columns={invoiceColumns({ withStatus: true })}
                rows={rows}
                rowKey={(i) => i.id}
                caption={`${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} for this subscription`}
                emptyMessage={
                  data.has_more
                    ? `None of the tenant's ${INVOICE_READ} most recent invoices belong to this subscription.`
                    : "No invoices for this subscription yet."
                }
              />
              {data.has_more && (
                <p className="text-sm text-muted-foreground">
                  This reads the tenant's {INVOICE_READ} most recent invoices. Older ones are on the Invoices page, filtered by tenant.
                </p>
              )}
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
