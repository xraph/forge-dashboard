import { useState } from "react"
import type { FormEvent } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import {
  Button,
  buttonVariants,
} from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { ProblemsAlert } from "../components/problems-alert"
import { useInFlight } from "../lib/in-flight"
import { formatMoney } from "../lib/money"
import { subscriptionPath } from "../lib/paths"
import type { Page, Plan, Subscription } from "../types"

/**
 * A new subscription for a tenant. Only active plans are offered: the engine
 * refuses a draft or archived one. A plan with a trial starts the
 * subscription trialing; the page says so rather than surprising anybody.
 */
export function LedgerSubscriptionCreatePage() {
  const plans = useQuery<Page<Plan>>("plans.list", {
    status: "active",
    limit: 200,
    offset: 0,
  })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="New subscription"
        description="Subscribe a tenant to an active plan."
      />
      <QueryBoundary title="Plans" query={plans} skeletonRows={3}>
        {(data) =>
          (data.items ?? []).length === 0 ? (
            <EmptyState
              title="There is no active plan to subscribe to."
              description="Create a plan and activate it first."
              action={
                <PluginLink
                  to="/plans"
                  className={buttonVariants({ variant: "outline" })}
                >
                  Go to plans
                </PluginLink>
              }
            />
          ) : (
            <SubscriptionForm plans={data.items} />
          )
        }
      </QueryBoundary>
    </section>
  )
}

/** The plan's price with its period, or nothing when it has none: a "none" billing period is not a month. */
function priceText(plan: Plan): string {
  if (!plan.pricing) return ""
  const price = formatMoney(plan.pricing.base_amount)
  switch (plan.pricing.billing_period) {
    case "yearly":
      return `${price} a year. `
    case "monthly":
      return `${price} a month. `
    default:
      return ""
  }
}

function SubscriptionForm({ plans }: { plans: Plan[] }) {
  const create = useCommand<Subscription>("subscriptions.create")
  const navigate = useNavigateTo()
  const once = useInFlight()
  const [tenant, setTenant] = useState("")
  const [planId, setPlanId] = useState("")
  const [seats, setSeats] = useState<Record<string, string>>({})
  const [problems, setProblems] = useState<string[]>([])
  const plan = plans.find((p) => p.id === planId)
  const seatFeatures = (plan?.features ?? []).filter((f) => f.type === "seat")
  const canSubmit =
    !create.loading && tenant.trim() !== "" && plan !== undefined

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || !plan) return
    const errors: string[] = []
    const quantity: Record<string, number> = {}
    for (const f of seatFeatures) {
      const text = (seats[f.key] ?? "").trim()
      if (text === "") continue
      // Past the safe integers the number is no longer what was typed, and Go's int64 would refuse it anyway.
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)))
        errors.push(`${f.name} must be a whole number, 0 or more.`)
      else quantity[f.key] = Number(text)
    }
    setProblems(errors)
    if (errors.length > 0) return
    const payload: Record<string, unknown> = {
      tenant_id: tenant.trim(),
      plan_id: plan.id,
    }
    if (Object.keys(quantity).length > 0) payload.quantity = quantity
    // One subscription per submit: the engine has no duplicate rule, so a second send is a second billed subscription.
    const result = await once(() => create.execute(payload))
    if (result === undefined) return
    navigate(subscriptionPath(result.id))
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex max-w-lg flex-col gap-4"
    >
      <CommandAlert
        error={create.error}
        title="Could not create the subscription"
      />
      <ProblemsAlert problems={problems} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sub-tenant">Tenant ID</Label>
        <Input
          id="sub-tenant"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          value={tenant}
          onChange={(e) => setTenant(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sub-plan">Plan</Label>
        <NativeSelect
          id="sub-plan"
          aria-describedby={plan ? "sub-plan-help" : undefined}
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
        >
          <NativeSelectOption value="">Choose a plan</NativeSelectOption>
          {plans.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {plan && (
          <p id="sub-plan-help" className="text-xs text-muted-foreground">
            {priceText(plan)}
            {plan.trial_days > 0
              ? `Starts with a ${plan.trial_days}-day trial.`
              : "Starts active, with no trial."}
          </p>
        )}
      </div>
      {seatFeatures.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <Label htmlFor={`sub-seats-${f.key}`}>{f.name}</Label>
          <Input
            id={`sub-seats-${f.key}`}
            aria-describedby={`sub-seats-${f.key}-help`}
            inputMode="numeric"
            className="w-32 text-right tabular-nums"
            value={seats[f.key] ?? ""}
            onChange={(e) =>
              setSeats((prev) => ({ ...prev, [f.key]: e.target.value }))
            }
          />
          <p
            id={`sub-seats-${f.key}-help`}
            className="text-xs text-muted-foreground"
          >
            Leave empty to start with none.
          </p>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {create.loading ? "Creating…" : "Create subscription"}
        </Button>
        <PluginLink
          to="/subscriptions"
          className="self-center text-sm underline"
        >
          Cancel
        </PluginLink>
      </div>
    </form>
  )
}
