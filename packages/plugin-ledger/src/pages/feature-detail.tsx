import { useState } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList, DetailLayout } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { FeatureStatusBadge, SharedBadge } from "../badges"
import { ConfirmAction } from "../components/confirm-action"
import { isNotFound, NotFoundState } from "../components/not-found"
import { SyncPanel } from "../components/sync-panel"
import { featureEditPath } from "../lib/paths"
import type { Ack, CatalogFeature } from "../types"
import { defaultLimitText, PERIOD, TYPE } from "./feature-form"

export function LedgerFeatureDetailPage({ params }: PluginPageProps) {
  const id = params.id
  if (!id) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        No feature id in the address, so there is nothing to show.
      </p>
    )
  }
  return <FeatureDetailBody id={id} />
}

function FeatureDetailBody({ id }: { id: string }) {
  const detail = useQuery<CatalogFeature>("features.detail", { id })
  if (detail.data !== undefined) return <FeatureDetailView feature={detail.data} />
  if (isNotFound(detail.error, "feature")) return <NotFoundState noun="feature" id={id} backTo="/features" backLabel="Back to features" />
  return (
    <QueryBoundary title="Feature" query={detail} skeletonRows={4}>
      {(f) => <FeatureDetailView feature={f} />}
    </QueryBoundary>
  )
}

function FeatureDetailView({ feature }: { feature: CatalogFeature }) {
  const archive = useCommand<Ack>("features.archive")
  const remove = useCommand<Ack>("features.delete")
  const navigate = useNavigateTo()
  const [pending, setPending] = useState<"archive" | "delete" | null>(null)

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title={feature.name}
        actions={
          <>
            <PluginLink to={featureEditPath(feature.id)} className={buttonVariants({ variant: "outline" })}>
              Edit
            </PluginLink>
            {feature.status !== "archived" && (
              <Button
                variant="outline"
                onClick={() => {
                  archive.reset()
                  setPending("archive")
                }}
              >
                Archive
              </Button>
            )}
            <Button
              variant="destructive"
              onClick={() => {
                remove.reset()
                setPending("delete")
              }}
            >
              Delete
            </Button>
          </>
        }
      />
      {feature.app_id === "" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <SharedBadge /> Shared by every app on this server. It can be changed only with no app selected.
        </p>
      )}
      <DetailLayout
        main={
          <DescriptionList
            items={[
              { term: "Key", value: <span className="font-mono text-xs">{feature.key}</span> },
              { term: "Type", value: TYPE[feature.type] ?? feature.type },
              { term: "Default limit", value: <span className="tabular-nums">{defaultLimitText(feature)}</span> },
              { term: "Resets", value: PERIOD[feature.period] ?? feature.period },
              { term: "Over the limit", value: feature.soft_limit ? "Soft: billed as overage" : "Hard: refused" },
              { term: "Status", value: <FeatureStatusBadge status={feature.status} /> },
              { term: "Description", value: feature.description || <NoneCell label="description" /> },
              { term: "Created", value: <Timestamp value={feature.created_at} label="creation" /> },
              { term: "Updated", value: <Timestamp value={feature.updated_at} label="update" /> },
            ]}
          />
        }
        aside={<SyncPanel intent="features.syncToProvider" id={feature.id} providerName={feature.provider_name} providerId={feature.provider_id} />}
      />
      <ConfirmAction
        open={pending === "archive"}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Archive ${feature.name}?`}
        description="It stays on plans that already include it and is marked archived in the catalog."
        confirmLabel="Archive feature"
        command={archive}
        payload={{ id: feature.id }}
        onDone={() => setPending(null)}
      />
      <ConfirmAction
        open={pending === "delete"}
        onOpenChange={(o) => !o && setPending(null)}
        title={`Delete ${feature.name}?`}
        description="This cannot be undone. Plans keep their own copy of the feature's key and limit."
        confirmLabel="Delete feature"
        destructive
        command={remove}
        payload={{ id: feature.id }}
        onDone={() => navigate("/features")}
      />
    </section>
  )
}
