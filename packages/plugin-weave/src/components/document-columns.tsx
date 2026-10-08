import { PluginLink } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { DocumentStateCell } from "../badges"
import { formatBytes, formatCount } from "../format"
import { collectionPath, documentPath } from "../links"
import type { DocumentRow } from "../types"
import { IdLink } from "./id"

/**
 * The columns every document table shares: Overview's newest documents,
 * a collection's documents, and the Documents page. A collection's own page
 * leaves the collection column out, because every row would say the same.
 */
export function documentColumns({ withCollection }: { withCollection: boolean }): Column<DocumentRow>[] {
  const columns: Column<DocumentRow>[] = [
    {
      id: "title",
      header: "Title",
      className: "font-medium",
      cell: (d) =>
        d.title ? (
          <PluginLink to={documentPath(d.id)} className="font-medium underline-offset-4 hover:underline">
            {d.title}
          </PluginLink>
        ) : (
          <NoneCell label="title" />
        ),
    },
    { id: "id", header: "ID", cell: (d) => <IdLink to={documentPath(d.id)} value={d.id} label={`Open document ${d.id}`} /> },
  ]
  if (withCollection) {
    columns.push({
      id: "collection",
      header: "Collection",
      cell: (d) =>
        d.collection_name !== "" ? (
          <PluginLink to={collectionPath(d.collection_id)} className="underline-offset-4 hover:underline">
            {d.collection_name}
          </PluginLink>
        ) : (
          <span className="text-sm text-muted-foreground">deleted collection</span>
        ),
    })
  }
  columns.push(
    { id: "state", header: "State", cell: (d) => <DocumentStateCell doc={d} /> },
    { id: "chunks", header: "Chunks", align: "end", cell: (d) => <span className="tabular-nums">{formatCount(d.chunk_count)}</span> },
    { id: "size", header: "Size", align: "end", cell: (d) => <span className="font-mono text-xs tabular-nums">{formatBytes(d.content_length)}</span> },
    { id: "updated", header: "Updated", cell: (d) => <Timestamp value={d.updated_at} label="update" /> },
  )
  return columns
}
