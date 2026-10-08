import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  ResourceTable,
  type Column,
} from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { formatCount, plural } from "../format"
import { retrieverSentence, scoreMeaning } from "../score"
import type {
  Components,
  ComponentsOutput,
  ExtensionInfo,
  PipelineComponent,
  ScoreKind,
} from "../types"

interface StageRow {
  key: string
  label: string
  component: PipelineComponent
  /** What it means for this stage to be missing. */
  absent: string
}

function stagesOf(c: Components): StageRow[] {
  return [
    {
      key: "loader",
      label: "Loader",
      component: c.loader,
      absent: "Not configured.",
    },
    {
      key: "chunker",
      label: "Chunker",
      component: c.chunker,
      absent: "Not configured, so Weave can't ingest.",
    },
    {
      key: "embedder",
      label: "Embedder",
      component: c.embedder,
      absent: "Not configured, so Weave can't ingest or search.",
    },
    {
      key: "vector_store",
      label: "Vector store",
      component: c.vector_store,
      absent: "Not configured, so Weave can't ingest or search.",
    },
    {
      key: "retriever",
      label: "Retriever",
      component: c.retriever,
      absent: "Not configured, so Weave returns the vector search as it is.",
    },
  ]
}

function paramsOf(c: PipelineComponent): string[] {
  const out = Object.keys(c.params ?? {})
    .sort()
    .map((k) => `${k}=${c.params![k]}`)
  if (c.dimensions) out.push(`dimensions=${c.dimensions}`)
  for (const child of c.children ?? []) out.push(`child=${child.kind}`)
  return out
}

/** The score column needs the store's score, which a passed-through score (MMR) is read in. */
function stageColumns(vectorScore: ScoreKind | undefined): Column<StageRow>[] {
  return [
    {
      id: "stage",
      header: "Stage",
      className: "font-medium",
      cell: (s) => s.label,
    },
    {
      id: "kind",
      header: "Kind",
      cell: (s) =>
        s.component.configured && s.component.kind !== "" ? (
          <span className="font-mono text-xs">{s.component.kind}</span>
        ) : (
          <span className="text-sm text-muted-foreground">{s.absent}</span>
        ),
    },
    {
      id: "params",
      header: "Parameters",
      cell: (s) => (
        <TagList values={paramsOf(s.component)} label="parameters" />
      ),
    },
    {
      id: "score",
      header: "Score",
      cell: (s) =>
        s.component.score ? (
          <span className="text-sm">
            {scoreMeaning(s.component.score, vectorScore)}
          </span>
        ) : (
          <NoneCell label="score" />
        ),
    },
    {
      id: "type",
      header: "Go type",
      cell: (s) =>
        s.component.type ? (
          <span className="font-mono text-xs">{s.component.type}</span>
        ) : (
          <NoneCell label="type" />
        ),
    },
  ]
}

const extensionColumns: Column<ExtensionInfo>[] = [
  {
    id: "name",
    header: "Extension",
    className: "font-medium",
    cell: (x) => x.name,
  },
  {
    id: "hooks",
    header: "Hooks it implements",
    cell: (x) => <TagList values={x.hooks} label="hooks" />,
  },
]

export const PipelinePage: ComponentType<PluginPageProps> = () => {
  const report = useQuery<ComponentsOutput>("system.components", {})

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Pipeline"
        description="What this deployment of Weave actually runs, as the engine reports it."
      />
      <QueryBoundary title="Pipeline" query={report} skeletonRows={6}>
        {(data) => (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Stages</h2>
              <p className="text-sm text-muted-foreground">
                {retrieverSentence(data.components)}
              </p>
              <ResourceTable<StageRow>
                columns={stageColumns(data.components.vector_store.score)}
                rows={stagesOf(data.components)}
                rowKey={(s) => s.key}
                caption="5 stages"
                emptyMessage="The engine reported no stages."
              />
              <p className="text-sm">
                {data.components.tenant_filter === "verified"
                  ? "Tenant filtering on this vector store is covered by Weave's tests."
                  : "Weave can't check tenant filtering on this vector store, so treat a search filtered by tenant as unverified."}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">
                Content types the loader reads
              </h2>
              <p className="text-sm text-muted-foreground">
                Asked of the loader itself, so this is what it accepts, not a
                list someone wrote down.
              </p>
              <TagList
                values={data.components.loader.content_types ?? []}
                label="content types"
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Engine config</h2>
              <DescriptionList
                items={[
                  {
                    term: "Default chunk size",
                    value: `${formatCount(data.config.default_chunk_size)} tokens`,
                  },
                  {
                    term: "Default chunk overlap",
                    value: `${formatCount(data.config.default_chunk_overlap)} tokens`,
                  },
                  {
                    term: "Embedding model",
                    value: (
                      <span>
                        <span className="font-mono text-xs">
                          {data.config.default_embedding_model}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          recorded on new collections and never read back
                        </span>
                      </span>
                    ),
                  },
                  {
                    term: "Chunk strategy",
                    value: (
                      <span>
                        <span className="font-mono text-xs">
                          {data.config.default_chunk_strategy}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          recorded on new collections and never read back
                        </span>
                      </span>
                    ),
                  },
                  {
                    term: "Default top K",
                    value: formatCount(data.config.default_top_k),
                  },
                  {
                    term: "Shutdown timeout",
                    value: `${data.config.shutdown_timeout_seconds} s`,
                  },
                ]}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">What Weave doesn't do</h2>
              <ul className="list-disc pl-5 text-sm">
                <li>
                  One embedder and one chunker serve every collection. A
                  collection's model, dimensions and strategy are written down
                  when it is made and never used.
                </li>
                <li>
                  Reindex re-embeds the chunks a collection already has with the
                  current embedder. It never re-chunks.
                </li>
                <li>
                  Weave keeps a hash and a length of each source, never the
                  source text.
                </li>
                <li>
                  The retrieve API's strategy parameter does nothing: Weave runs
                  the one retriever it was configured with.
                </li>
                <li>
                  Weave ships no migration for the pgvector table,
                  weave_vectors, so a pgvector deployment has to create it
                  itself.
                </li>
              </ul>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Extensions</h2>
              <ResourceTable<ExtensionInfo>
                columns={extensionColumns}
                rows={data.extensions}
                rowKey={(x) => x.name}
                caption={plural(
                  data.extensions.length,
                  "extension",
                  "extensions"
                )}
                emptyMessage="No extensions are registered."
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
