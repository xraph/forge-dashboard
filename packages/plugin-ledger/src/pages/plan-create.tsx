import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { useInFlight } from "../lib/in-flight"
import { planPath } from "../lib/paths"
import type { Plan } from "../types"
import { emptyPlanForm, PlanForm, type ParsedPlan } from "./plan-form"

/** A new plan starts as a draft; nothing can subscribe to it until it is activated. */
export function LedgerPlanCreatePage() {
  const create = useCommand<Plan>("plans.create")
  const navigate = useNavigateTo()
  const once = useInFlight()

  async function submit(plan: ParsedPlan) {
    const result = await once(() => create.execute(plan))
    if (result === undefined) return
    navigate(planPath(result.id))
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="New plan" description="It starts as a draft. Activate it from its page when it is ready to sell." />
      <PlanForm
        mode="create"
        initial={emptyPlanForm()}
        submitLabel="Create plan"
        pendingLabel="Creating…"
        pending={create.loading}
        error={create.error}
        errorTitle="Could not create the plan"
        cancelTo="/plans"
        onSubmit={(p) => void submit(p)}
      />
    </section>
  )
}
