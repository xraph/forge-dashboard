import { useCommand, useNavigateTo } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { useInFlight } from "../lib/in-flight"
import { featurePath } from "../lib/paths"
import type { CatalogFeature } from "../types"
import {
  emptyFeatureForm,
  FeatureForm,
  type ParsedFeature,
} from "./feature-form"

export function LedgerFeatureCreatePage() {
  const create = useCommand<CatalogFeature>("features.create")
  const navigate = useNavigateTo()
  const once = useInFlight()
  async function submit(f: ParsedFeature) {
    const result = await once(() => create.execute(f))
    if (result === undefined) return
    navigate(featurePath(result.id))
  }
  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="New feature"
        description="A reusable feature plans can grant. With no app selected it is created in the shared catalog."
      />
      <FeatureForm
        mode="create"
        initial={emptyFeatureForm()}
        submitLabel="Create feature"
        pendingLabel="Creating…"
        pending={create.loading}
        error={create.error}
        errorTitle="Could not create the feature"
        cancelTo="/features"
        onSubmit={(f) => void submit(f)}
      />
    </section>
  )
}
