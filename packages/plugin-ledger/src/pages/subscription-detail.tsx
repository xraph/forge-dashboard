import { useState } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import {
  DescriptionList,
  DetailLayout,
} from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
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
import type {
  Coupon,
  Invoice,
  Page,
  Plan,
  SettingsDetail,
  Subscription,
  SubscriptionDetail,
  SubscriptionStatus,
} from "../types"

export type SubscriptionAction =
  "generate" | "changePlan" | "applyCoupon" | "pause" | "resume" | "cancel"

/**
 * The actions the engine allows from each state, so the page never offers a
 * button that promises a refusal.
 *
 * Checked against the engine. Pause takes active and trialing only, resume
 * takes paused only, and cancel and change-plan refuse only a canceled or
 * expired subscription, so a past-due or paused one can still be cancelled or
 * moved. The engine puts no status rule on generating an invoice or applying a
 * coupon. Generate stays available once a subscription has ended, because an
 * immediate cancel would otherwise strand the final period's overage and seats
 * with no way to invoice them; the engine refuses a second invoice for the same
 * period as a conflict, which the alert shows. It is withheld from a paused
 * subscription: the engine refuses to invoice a paused subscription's current
 * period, because a resume moves that period's end on by the time spent paused
 * and the period is invoiced once it ends. Apply coupon is withheld from paused
 * and finished subscriptions: a discount on one that is not running helps
 * nobody.
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
    case "canceled":
    case "expired":
      return ["generate"]
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
  // Keyed by id, so moving between subscriptions in place starts with fresh dialog state and a fresh clock.
  return <SubscriptionDetailBody key={id} id={id} />
}

function SubscriptionDetailBody({ id }: { id: string }) {
  const detail = useQuery<SubscriptionDetail>("subscriptions.detail", { id })
  // Once there is data the page stays up through a refresh: a write
  // invalidates subscriptions.detail, and QueryBoundary would otherwise swap
  // the page for a skeleton and take any open dialog with it.
  if (detail.data !== undefined)
    return <SubscriptionDetailView detail={detail.data} />
  if (isNotFound(detail.error, "subscription")) {
    return (
      <NotFoundState
        noun="subscription"
        id={id}
        backTo="/subscriptions"
        backLabel="Back to subscriptions"
      />
    )
  }
  return (
    <QueryBoundary title="Subscription" query={detail} skeletonRows={6}>
      {(d) => <SubscriptionDetailView detail={d} />}
    </QueryBoundary>
  )
}

type Dialog =
  "pause" | "resume" | "cancel" | "changePlan" | "applyCoupon" | null

/**
 * The note beside a cancellation date that has passed. What ends the
 * subscription is the ledger's lifecycle clock, so the note asks the ledger
 * whether it runs. Until the answer arrives, when it is refused, or from a
 * ledger that does not send the interval, it claims only what is known.
 */
function PassedNote() {
  const settings = useQuery<SettingsDetail>("settings.detail")
  const interval = settings.data?.lifecycle_interval
  let text = "Date passed, not yet ended"
  if (interval === "off")
    text =
      "Date passed, but the lifecycle clock is off. It ends only when something else runs it."
  else if (interval !== undefined)
    text = `Date passed, ends on the next lifecycle clock run (every ${interval})`
  return <span className="text-xs text-muted-foreground">{text}</span>
}

/**
 * What a resume does. The engine extends the period end by the time since
 * paused_at, and a trial still running at the pause by the same amount. A row
 * paused before the engine recorded paused_at has no pause start to measure
 * from, so a resume extends nothing, and the text says that instead.
 */
function resumeDescription(sub: Subscription): string {
  if (sub.paused_at === undefined) {
    return "This subscription has no recorded pause start, so resuming extends nothing: its billing period and trial end stay where they are. It returns to trialing if its trial has not ended, and becomes active otherwise."
  }
  return "Resuming extends the billing period's end by the time spent paused, and the period can be invoiced once it ends. A trial that had not ended at the pause moves out by the same amount and the subscription returns to trialing. Otherwise it becomes active."
}

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
  // The aside judges "past" against when the page was opened, not on every render.
  const [now] = useState(() => Date.now())
  // The cancel dialog judges it against the moment the dialog opens (set in openDialog).
  const [openedAt, setOpenedAt] = useState(() => Date.now())

  function openDialog(which: Exclude<Dialog, null>) {
    // Reset at open, and clear what the dialog collects, so nothing from an
    // earlier attempt is shown against this one. The plan-change dialog owns
    // its command and its choices and is mounted only while open, so it starts
    // clean on its own.
    if (which !== "changePlan")
      ({ pause, resume, cancel, applyCoupon })[which].reset()
    setImmediately(false)
    setCode("")
    setOpenedAt(Date.now())
    setDialog(which)
  }

  async function generateInvoice() {
    const result = await generate.execute({ subscription_id: sub.id })
    if (result !== undefined) navigate(invoicePath(result.id))
  }

  const close = (o: boolean) => !o && setDialog(null)
  // Cancelling always sets cancel_at. An immediate cancel ends the
  // subscription at once; a later one is ended by the ledger's lifecycle clock,
  // when it runs, on its first run after the date, which sets canceled_at to
  // cancel_at. Until then the status is still active, which the row says. The
  // engine never writes ended_at.
  const isCanceled = sub.status === "canceled"
  const datePassed =
    !isCanceled &&
    sub.status !== "expired" &&
    sub.cancel_at !== undefined &&
    Date.parse(sub.cancel_at) < now
  const cancelRow = {
    term: isCanceled ? "Canceled" : "Scheduled to cancel",
    value: (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <Timestamp
          value={
            isCanceled ? (sub.canceled_at ?? sub.cancel_at) : sub.cancel_at
          }
          label="scheduled cancellation"
        />
        {datePassed && <PassedNote />}
      </span>
    ),
  }
  const periodEnded = Date.parse(sub.current_period_end) <= openedAt
  const seatText = Object.entries(sub.quantity ?? {}).map(
    ([k, n]) => `${k}: ${n}`
  )

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={`${sub.tenant_id} on ${plan.name}`}
        actions={
          actions.length > 0 && (
            <>
              {actions.includes("generate") && (
                <Button
                  variant="outline"
                  disabled={generate.loading}
                  onClick={() => void generateInvoice()}
                >
                  {generate.loading ? "Generating…" : "Generate invoice"}
                </Button>
              )}
              {actions.includes("changePlan") && (
                <Button
                  variant="outline"
                  onClick={() => openDialog("changePlan")}
                >
                  Change plan
                </Button>
              )}
              {actions.includes("applyCoupon") && (
                <Button
                  variant="outline"
                  onClick={() => openDialog("applyCoupon")}
                >
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
                <Button
                  variant="destructive"
                  onClick={() => openDialog("cancel")}
                >
                  Cancel subscription
                </Button>
              )}
            </>
          )
        }
      />
      <CommandAlert
        error={generate.error}
        title="Could not generate an invoice"
      />

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
                {
                  term: "Status",
                  value: <SubscriptionStatusBadge status={sub.status} />,
                },
                {
                  term: "Plan",
                  value: (
                    <PluginLink to={planPath(plan.id)}>{plan.name}</PluginLink>
                  ),
                },
                {
                  term: "Tenant",
                  value: (
                    <span className="font-mono text-xs">{sub.tenant_id}</span>
                  ),
                },
                {
                  term: "Current period",
                  value: formatPeriod(
                    sub.current_period_start,
                    sub.current_period_end
                  ),
                },
                {
                  term: "Trial",
                  value:
                    sub.trial_start && sub.trial_end ? (
                      formatPeriod(sub.trial_start, sub.trial_end)
                    ) : (
                      <NoneCell label="trial" />
                    ),
                },
                ...(sub.paused_at
                  ? [
                      {
                        term: "Paused since",
                        value: (
                          <Timestamp value={sub.paused_at} label="pause" />
                        ),
                      },
                    ]
                  : []),
                cancelRow,
                {
                  term: "Seats",
                  value:
                    seatText.length > 0 ? (
                      <span className="font-mono text-xs">
                        {seatText.join(", ")}
                      </span>
                    ) : (
                      <NoneCell label="seat counts" />
                    ),
                },
                {
                  term: "Started",
                  value: <Timestamp value={sub.created_at} label="start" />,
                },
              ]}
            />
            <section
              className="flex flex-col gap-2"
              aria-label="Applied coupons"
            >
              <h2 className="text-sm font-medium">Coupons</h2>
              {coupons.length === 0 ? (
                <NoneCell label="applied coupons" />
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {coupons.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-baseline justify-between gap-2"
                    >
                      <PluginLink
                        to={couponPath(c.id)}
                        className="font-mono text-xs"
                      >
                        {c.code}
                      </PluginLink>
                      <span className="text-muted-foreground tabular-nums">
                        {describeDiscount(c)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <SyncPanel
              intent="subscriptions.syncToProvider"
              id={sub.id}
              providerName={sub.provider_name}
              providerId={sub.provider_id}
            />
          </>
        }
      />

      <ConfirmAction
        open={dialog === "pause"}
        onOpenChange={close}
        title={`Pause ${sub.tenant_id}'s subscription?`}
        description="Entitlement checks refuse while it is paused. Resume it to restore access. Pausing freezes the billing period, and the current period cannot be invoiced while the subscription is paused. Resuming extends the period's end by the time spent paused, and the period can be invoiced once it ends. A trial still running at the pause moves out by the same amount."
        confirmLabel="Pause subscription"
        command={pause}
        payload={{ id: sub.id }}
        onDone={() => setDialog(null)}
      />
      <ConfirmAction
        open={dialog === "resume"}
        onOpenChange={close}
        title={`Resume ${sub.tenant_id}'s subscription?`}
        description={resumeDescription(sub)}
        confirmLabel="Resume subscription"
        command={resume}
        payload={{ id: sub.id }}
        onDone={() => setDialog(null)}
      />
      <ConfirmAction
        open={dialog === "cancel"}
        onOpenChange={close}
        title={`Cancel ${sub.tenant_id}'s subscription?`}
        description="A canceled subscription cannot be restarted. The tenant would need a new one."
        confirmLabel="Cancel it"
        destructive
        command={cancel}
        payload={{ id: sub.id, immediately }}
        onDone={() => setDialog(null)}
      >
        <div
          role="radiogroup"
          aria-label="When to cancel"
          className="flex flex-col gap-2 text-xs/relaxed"
        >
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="cancel-when"
              checked={!immediately}
              onChange={() => setImmediately(false)}
            />
            {periodEnded
              ? `The period ended on ${formatDay(sub.current_period_end)}, so the cancellation is dated then. The subscription keeps its current status until the ledger ends it. Choose End it now to stop it today.`
              : `Schedule the cancellation for the end of the period, ${formatDay(sub.current_period_end)}. It keeps its current status until then.`}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="cancel-when"
              checked={immediately}
              onChange={() => setImmediately(true)}
            />
            End it now
          </label>
        </div>
      </ConfirmAction>
      <ConfirmAction
        open={dialog === "applyCoupon"}
        onOpenChange={close}
        title={`Apply a coupon to ${sub.tenant_id}'s subscription`}
        confirmLabel="Apply"
        command={applyCoupon}
        payload={{ subscription_id: sub.id, code: code.trim() }}
        confirmDisabled={code.trim() === ""}
        onDone={() => setDialog(null)}
      >
        <div className="flex flex-col gap-1.5">
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
          <p
            id="apply-code-help"
            className="text-xs/relaxed text-muted-foreground"
          >
            It applies from the next invoice. Invoices already issued are not
            changed.
          </p>
        </div>
      </ConfirmAction>
      {/* Mounted only while open: it reads the plan list, and useQuery fires on mount. */}
      {dialog === "changePlan" && (
        <ChangePlanDialog
          subscription={sub}
          current={plan}
          onClose={() => setDialog(null)}
        />
      )}
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
function ChangePlanDialog({
  subscription: sub,
  current,
  onClose,
}: {
  subscription: Subscription
  current: Plan
  onClose: () => void
}) {
  const changePlan = useCommand<Subscription>("subscriptions.changePlan")
  const plans = useQuery<Page<Plan>>("plans.list", {
    status: "active",
    limit: 200,
    offset: 0,
  })
  const [newPlan, setNewPlan] = useState("")
  const [clear, setClear] = useState(false)
  const choices = (plans.data?.items ?? []).filter((p) => p.id !== current.id)
  const target = choices.find((p) => p.id === newPlan)

  const seatKeys = new Set(
    (target?.features ?? []).filter((f) => f.type === "seat").map((f) => f.key)
  )
  const carried = Object.entries(sub.quantity ?? {})
  const stranded = target
    ? carried.filter(([key]) => !seatKeys.has(key)).map(([key]) => key)
    : []

  const payload: Record<string, unknown> = { id: sub.id, plan_id: newPlan }
  if (stranded.length > 0 && clear)
    payload.quantity = Object.fromEntries(
      carried.filter(([key]) => seatKeys.has(key))
    )

  return (
    <ConfirmAction
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Move ${sub.tenant_id} to another plan`}
      confirmLabel="Change plan"
      command={changePlan}
      payload={payload}
      confirmDisabled={newPlan === "" || (stranded.length > 0 && !clear)}
      onDone={onClose}
    >
      <div className="flex flex-col gap-1.5 text-xs/relaxed">
        <Label htmlFor="change-plan">New plan</Label>
        <NativeSelect
          id="change-plan"
          aria-describedby="change-plan-help"
          className="w-full"
          value={newPlan}
          onChange={(e) => {
            setNewPlan(e.target.value)
            setClear(false)
          }}
          disabled={plans.loading}
        >
          <NativeSelectOption value="">
            {plans.loading ? "Loading plans…" : "Choose a plan"}
          </NativeSelectOption>
          {choices.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <p id="change-plan-help" className="text-muted-foreground">
          Seat counts carry over. The change is not prorated: the next invoice
          bills the new plan for the whole period.
        </p>
        {target && stranded.length > 0 && (
          <>
            <p>{`${target.name} has no seat feature for ${stranded.join(", ")}, so those seat counts cannot carry over.`}</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={clear}
                onChange={(e) => setClear(e.target.checked)}
              />
              {`Clear the seat counts for ${stranded.join(", ")}`}
            </label>
          </>
        )}
        <CommandAlert title="Could not load the plans" error={plans.error} />
      </div>
    </ConfirmAction>
  )
}

/**
 * This subscription's invoices. invoices.list filters by tenant, not by
 * subscription, so this reads the tenant's newest 200 and keeps the ones for
 * this subscription. A tenant with more than that is told where the rest are.
 */
function SubscriptionInvoices({
  subscription,
}: {
  subscription: Subscription
}) {
  const list = useQuery<Page<Invoice>>("invoices.list", {
    tenant_id: subscription.tenant_id,
    limit: INVOICE_READ,
    offset: 0,
  })
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium">Invoices</h2>
      <QueryBoundary title="Invoices" query={list} skeletonRows={3}>
        {(data) => {
          const rows = (data.items ?? []).filter(
            (i) => i.subscription_id === subscription.id
          )
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
                  This reads the tenant's {INVOICE_READ} most recent invoices.
                  Older ones are on the Invoices page, filtered by tenant.
                </p>
              )}
            </>
          )
        }}
      </QueryBoundary>
    </section>
  )
}
