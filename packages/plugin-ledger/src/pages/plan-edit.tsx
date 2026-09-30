import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { isNotFound, NotFoundState } from "../components/not-found"
import { planPath } from "../lib/paths"
import type { Plan } from "../types"
import { PlanForm, planToForm, type ParsedPlan } from "./plan-form"

export function LedgerPlanEditPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No plan id in the address, so there is nothing to edit.
      </p>
    )
  }
  return <PlanEditBody id={id} />
}

function PlanEditBody({ id }: { id: string }) {
  const detail = useQuery<Plan>("plans.detail", { id })
  const update = useCommand<Plan>("plans.update")
  const navigate = useNavigateTo()

  async function submit(plan: ParsedPlan) {
    // The currency is fixed once a plan exists, so it is never sent.
    const { currency: _currency, ...rest } = plan
    void _currency
    const result = await update.execute({ id, ...rest })
    if (result === undefined) return
    navigate(planPath(id))
  }

  if (isNotFound(detail.error, "plan")) {
    return <NotFoundState noun="plan" id={id} backTo="/plans" backLabel="Back to plans" />
  }

  return (
    <QueryBoundary title="Plan" query={detail} skeletonRows={6}>
      {(p) => (
        <section className="flex flex-col gap-4">
          <PageHeader title={`Edit ${p.name}`} description="Price and feature changes apply from the next invoice. Existing invoices are not recalculated." />
          <PlanForm
            key={p.id}
            mode="edit"
            initial={planToForm(p)}
            submitLabel="Save changes"
            pendingLabel="Saving…"
            pending={update.loading}
            error={update.error}
            errorTitle="Could not save the plan"
            cancelTo={planPath(id)}
            onSubmit={(plan) => void submit(plan)}
          />
        </section>
      )}
    </QueryBoundary>
  )
}
