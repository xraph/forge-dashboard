import { useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { isNotFound, NotFoundState } from "../components/not-found"
import { featurePath } from "../lib/paths"
import type { CatalogFeature } from "../types"
import { FeatureForm, featureToForm, type ParsedFeature } from "./feature-form"

export function LedgerFeatureEditPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No feature id in the address, so there is nothing to edit.
      </p>
    )
  }
  return <FeatureEditBody id={id} />
}

function FeatureEditBody({ id }: { id: string }) {
  const detail = useQuery<CatalogFeature>("features.detail", { id })
  const update = useCommand<CatalogFeature>("features.update")
  const navigate = useNavigateTo()

  async function submit(f: ParsedFeature) {
    // Key and type are fixed once a feature exists; they are never sent. Metadata
    // is never sent either: the engine keeps what an omitted field does not name.
    const result = await update.execute({ id, name: f.name, description: f.description, default_limit: f.default_limit, period: f.period, soft_limit: f.soft_limit })
    if (result === undefined) return
    navigate(featurePath(id))
  }

  const form = (f: CatalogFeature) => (
    <section className="flex flex-col gap-4">
      <PageHeader title={`Edit ${f.name}`} />
      <FeatureForm
        key={f.id}
        mode="edit"
        initial={featureToForm(f)}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        pending={update.loading}
        error={update.error}
        errorTitle="Could not save the feature"
        cancelTo={featurePath(id)}
        onSubmit={(parsed) => void submit(parsed)}
      />
    </section>
  )

  // Data already on screen stays up while a write's invalidation refetches, so the form keeps what was typed.
  if (detail.data !== undefined) return form(detail.data)
  if (isNotFound(detail.error, "feature")) return <NotFoundState noun="feature" id={id} backTo="/features" backLabel="Back to features" />
  return (
    <QueryBoundary title="Feature" query={detail} skeletonRows={4}>
      {form}
    </QueryBoundary>
  )
}
