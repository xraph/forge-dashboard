import { useState } from "react"
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { IdLink } from "../components/id"
import { formatCount, plural } from "../format"
import { chunkPath, documentPath, useSearchParam, useSetSearchParams } from "../links"
import { PAGE_SIZE, offsetFor, pageOf } from "../paging"
import { useCollectionOptions } from "../collection-options"
import type { Chunk, ListOutput } from "../types"

const columns: Column<Chunk>[] = [
  { id: "id", header: "Chunk", cell: (c) => <IdLink to={chunkPath(c.id)} value={c.id} label={`Open chunk ${c.id}`} /> },
  { id: "document", header: "Document", cell: (c) => <IdLink to={documentPath(c.document_id)} value={c.document_id} label={`Open document ${c.document_id}`} /> },
  { id: "index", header: "Position", align: "end", cell: (c) => <span className="tabular-nums">{c.index}</span> },
  { id: "text", header: "Text", className: "font-medium", cell: (c) => <span className="line-clamp-2 font-medium">{c.content}</span> },
  { id: "tokens", header: "Tokens", align: "end", cell: (c) => <span className="tabular-nums">{formatCount(c.token_count)}</span> },
  {
    id: "bytes",
    header: "Bytes",
    cell: (c) => (
      <span className="font-mono text-xs tabular-nums">
        {c.start_offset} to {c.end_offset}
      </span>
    ),
  },
]

/**
 * A collection's chunks, by document and then by position. Weave refuses an
 * unscoped listing, so the page asks for a collection first.
 */
export const ChunksPage: ComponentType<PluginPageProps> = () => {
  const collectionId = useSearchParam("collection_id")
  const setParams = useSetSearchParams("/chunks")
  const [offset, setOffset] = useState(0)
  const picker = useCollectionOptions(collectionId, "No collection chosen")
  const chunks = useQuery<ListOutput<Chunk>>("chunks.list", { collection_id: collectionId, limit: PAGE_SIZE, offset }, { enabled: collectionId !== "" })

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Chunks" description="What Weave stored for a collection, in reading order: by document, then by position." />
      <FilterBar
        filters={[
          {
            id: "collection",
            label: "Collection",
            value: collectionId,
            options: picker.options,
            onChange: (v) => {
              setOffset(0)
              setParams({ collection_id: v })
            },
          },
        ]}
      />
      {picker.note ? (
        <p className={picker.error ? "text-xs text-destructive" : "text-xs text-muted-foreground"} role={picker.error ? "alert" : "status"}>
          {picker.note}
        </p>
      ) : null}
      {collectionId === "" ? (
        <EmptyState title="Pick a collection" description="Chunks are listed one collection at a time, because a listing across every collection is a scan nobody needs." />
      ) : (
        <QueryBoundary title="Chunks" query={chunks} keepPreviousData>
          {(data) => (
            <ResourceTable<Chunk>
              columns={columns}
              rows={data.items}
              rowKey={(c) => c.id}
              caption={plural(data.total, "chunk", "chunks")}
              emptyMessage="This collection has no chunks yet. Ingest a document into it."
              pagination={pageOf(data)}
              onPageChange={(page) => setOffset(offsetFor(page, data.limit))}
            />
          )}
        </QueryBoundary>
      )}
    </section>
  )
}
