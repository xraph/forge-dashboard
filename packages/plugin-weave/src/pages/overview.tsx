import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { documentColumns } from "../components/document-columns"
import { formatAge, formatCount, plural } from "../format"
import type { Components, DocumentRow, Overview } from "../types"

const STAGES: {
  key: keyof Pick<
    Components,
    "loader" | "chunker" | "embedder" | "vector_store" | "retriever"
  >
  label: string
  none: string
}[] = [
  { key: "loader", label: "Loader", none: "loader" },
  { key: "chunker", label: "Chunker", none: "chunker" },
  { key: "embedder", label: "Embedder", none: "embedder" },
  { key: "vector_store", label: "Vector store", none: "vector store" },
  { key: "retriever", label: "Retriever", none: "retriever" },
]

/** One line naming what each stage runs. Pipeline has the detail. */
export function ComponentsStrip({ components }: { components: Components }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {STAGES.map((s) => {
        const c = components[s.key]
        return (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">{s.label}</span>
            {c.configured && c.kind !== "" ? (
              <span className="font-mono text-xs">{c.kind}</span>
            ) : (
              <NoneCell label={s.none} />
            )}
          </span>
        )
      })}
      <PluginLink to="/pipeline" className="underline-offset-4 hover:underline">
        See the pipeline
      </PluginLink>
    </div>
  )
}

const columns = documentColumns({ withCollection: true })

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const overview = useQuery<Overview>("system.overview", {})

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="What Weave holds and what it runs. This dashboard sees every tenant's data."
      />
      <QueryBoundary title="Overview" query={overview} skeletonRows={6}>
        {(data) => (
          <>
            <StatGrid
              items={[
                { label: "Collections", value: formatCount(data.collections) },
                { label: "Documents", value: formatCount(data.documents) },
                { label: "Chunks", value: formatCount(data.chunks) },
                {
                  label: "Ready",
                  value: formatCount(data.documents_by_state.ready),
                },
                {
                  label: "Pending",
                  value: formatCount(data.documents_by_state.pending),
                },
                {
                  label: "Processing",
                  value: formatCount(data.documents_by_state.processing),
                },
                {
                  label: "Failed",
                  value: formatCount(data.documents_by_state.failed),
                  tone:
                    data.documents_by_state.failed > 0 ? "danger" : "default",
                },
                {
                  label: "Looks stalled",
                  value: formatCount(data.stalled),
                  hint: `processing with no update for ${formatAge(data.stalled_after_seconds)}`,
                  tone: data.stalled > 0 ? "warning" : "default",
                },
              ]}
            />
            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="text-sm font-medium">What runs</h2>
              <ComponentsStrip components={data.components} />
            </section>
            <section className="flex min-w-0 flex-col gap-2">
              <h2 className="text-sm font-medium">Newest documents</h2>
              <ResourceTable<DocumentRow>
                columns={columns}
                rows={data.newest_documents}
                rowKey={(d) => d.id}
                caption={plural(
                  data.newest_documents.length,
                  "newest document",
                  "newest documents"
                )}
                emptyMessage="No documents yet. Open a collection and ingest one."
                emptyAction={
                  <PluginLink
                    to="/collections"
                    className="underline-offset-4 hover:underline"
                  >
                    Open collections
                  </PluginLink>
                }
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
