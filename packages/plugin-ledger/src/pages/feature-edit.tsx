import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { SharedBadge } from "../badges"
import { isNotFound, NotFoundState } from "../components/not-found"
import { useSharedWrites } from "../lib/app-scope"
import { useInFlight } from "../lib/in-flight"
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

  // Data already on screen stays up while a write's invalidation refetches, so the form keeps what was typed.
  if (detail.data !== undefined) return <FeatureEditView id={id} feature={detail.data} />
  if (isNotFound(detail.error, "feature")) return <NotFoundState noun="feature" id={id} backTo="/features" backLabel="Back to features" />
  return (
    <QueryBoundary title="Feature" query={detail} skeletonRows={4}>
      {(f) => <FeatureEditView id={id} feature={f} />}
    </QueryBoundary>
  )
}

function FeatureEditView({ id, feature: f }: { id: string; feature: CatalogFeature }) {
  const update = useCommand<CatalogFeature>("features.update")
  const navigate = useNavigateTo()
  const once = useInFlight()
  // A shared feature is changed only with no app selected; from an app the form would only end in a refusal.
  const writes = useSharedWrites(f.app_id === "")

  async function submit(parsed: ParsedFeature) {
    // Key and type are fixed once a feature exists; they are never sent. Metadata
    // is never sent either: the engine keeps what an omitted field does not name.
    const result = await once(() =>
      update.execute({ id, name: parsed.name, description: parsed.description, default_limit: parsed.default_limit, period: parsed.period, soft_limit: parsed.soft_limit }),
    )
    if (result === undefined) return
    navigate(featurePath(id))
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={`Edit ${f.name}`} />
      {writes === "wait" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Checking whether this feature can be changed from here…
        </p>
      ) : writes === "hide" ? (
        <div className="flex flex-col items-start gap-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <SharedBadge /> Shared by every app on this server. It can be changed only with no app selected.
          </p>
          <PluginLink to={featurePath(id)} className={buttonVariants({ variant: "outline" })}>
            Back to the feature
          </PluginLink>
        </div>
      ) : (
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
      )}
    </section>
  )
}
