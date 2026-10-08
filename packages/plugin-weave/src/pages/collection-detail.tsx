import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { ContractError, PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription } from "@forge-go/dashboard-kit/components/alert"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { documentColumns } from "../components/document-columns"
import { Id } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { formatCount, formatMs, plural } from "../format"
import { chunksHref, collectionEditPath, collectionIngestPath, documentsHref } from "../links"
import type { CollectionDetail, DocumentRow, IdOutput, ListOutput, ReindexOutput } from "../types"

const columns = documentColumns({ withCollection: false })

const REINDEX =
  "Reindex deletes every vector in this collection first, then re-embeds the chunks of its ready documents with the current embedder. It never re-chunks. It runs inside this request, and a failure partway leaves the collection partly indexed."

/**
 * A reindex that failed after it started has already deleted vectors. A
 * missing stage is refused before anything is touched, so it says nothing
 * about the collection's state.
 */
function mayBePartial(error: ContractError | undefined): boolean {
  if (!error) return false
  if (error.code === "INTERNAL") return true
  return error.code === "UNAVAILABLE" && !/configured/.test(error.message)
}

export const CollectionDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const detail = useQuery<CollectionDetail>("collections.get", { id })
  const docs = useQuery<ListOutput<DocumentRow>>("documents.list", { collection_id: id, limit: 10 })
  const reindex = useCommand<ReindexOutput>("collections.reindex")
  const remove = useCommand<IdOutput>("collections.delete")
  const navigateTo = useNavigateTo()
  const [dialog, setDialog] = useState<"reindex" | "delete" | null>(null)
  const [reindexed, setReindexed] = useState<ReindexOutput | null>(null)

  function open(kind: "reindex" | "delete") {
    // One hook per command, pointed at this collection: a failure from the
    // last attempt must not greet the next one.
    if (kind === "reindex") reindex.reset()
    else remove.reset()
    setDialog(kind)
  }

  function onOpenChange(next: boolean, pending: boolean) {
    if (!next && pending) return
    if (!next) setDialog(null)
  }

  async function runReindex() {
    const result = await reindex.execute({ id })
    if (result === undefined) return
    setReindexed(result)
    setDialog(null)
  }

  async function runDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    navigateTo("/collections", { replace: true })
  }

  return (
    <QueryBoundary title="Collection" query={detail} skeletonRows={8}>
      {(c) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={c.name}
            description={c.description}
            actions={
              <div className="flex gap-2">
                <PluginLink to={collectionIngestPath(c.id)} className={buttonVariants()}>
                  Ingest
                </PluginLink>
                <PluginLink to={collectionEditPath(c.id)} className={buttonVariants({ variant: "outline" })}>
                  Edit
                </PluginLink>
                <Button variant="outline" onClick={() => open("reindex")}>
                  Reindex
                </Button>
                <Button variant="destructive" onClick={() => open("delete")}>
                  Delete
                </Button>
              </div>
            }
          />

          {reindexed ? (
            <Alert>
              <AlertDescription>
                Re-embedded {plural(reindexed.reindexed_documents, "document", "documents")} in {formatMs(reindexed.elapsed_ms)}.
              </AlertDescription>
            </Alert>
          ) : null}

          <StatGrid
            items={[
              { label: "Documents", value: formatCount(c.document_count) },
              { label: "Chunks", value: formatCount(c.chunk_count) },
              { label: "Ready", value: formatCount(c.documents_by_state.ready) },
              { label: "Pending", value: formatCount(c.documents_by_state.pending) },
              { label: "Processing", value: formatCount(c.documents_by_state.processing) },
              { label: "Failed", value: formatCount(c.documents_by_state.failed), tone: c.documents_by_state.failed > 0 ? "danger" : "default" },
              { label: "Looks stalled", value: formatCount(c.stalled), tone: c.stalled > 0 ? "warning" : "default" },
            ]}
          />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Details</h2>
            <DescriptionList
              items={[
                { term: "ID", value: <Id value={c.id} /> },
                { term: "Tenant", value: c.tenant_id !== "" ? <Id value={c.tenant_id} /> : <NoneCell label="tenant" /> },
                { term: "App", value: c.app_id !== "" ? <Id value={c.app_id} /> : <NoneCell label="app" /> },
                { term: "Created", value: <Timestamp value={c.created_at} label="creation date" /> },
                { term: "Updated", value: <Timestamp value={c.updated_at} label="update" /> },
                { term: "Chunk size", value: <span className="font-mono text-xs">{formatCount(c.chunk_size)} tokens</span> },
                { term: "Chunk overlap", value: <span className="font-mono text-xs">{formatCount(c.chunk_overlap)} tokens</span> },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2 rounded-md border p-3">
            <h2 className="text-sm font-medium">Embedding model, dimensions and strategy</h2>
            <p className="text-sm text-muted-foreground">Recorded when the collection was made and never used: one embedder and one chunker serve every collection.</p>
            <DescriptionList
              items={[
                { term: "Model", value: <span className="font-mono text-xs">{c.embedding_model || "none"}</span> },
                { term: "Dimensions", value: <span className="font-mono text-xs">{c.embedding_dims}</span> },
                { term: "Strategy", value: <span className="font-mono text-xs">{c.chunk_strategy || "none"}</span> },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Metadata</h2>
            <MetadataList metadata={c.metadata} />
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Newest documents</h2>
              <div className="flex gap-4 text-sm">
                <PluginLink to={documentsHref({ collection_id: c.id })} className="underline-offset-4 hover:underline">
                  All documents in this collection
                </PluginLink>
                <PluginLink to={chunksHref(c.id)} className="underline-offset-4 hover:underline">
                  Its chunks
                </PluginLink>
              </div>
            </div>
            <QueryBoundary title="Documents" query={docs} skeletonRows={3}>
              {(list) => (
                <ResourceTable<DocumentRow>
                  columns={columns}
                  rows={list.items}
                  rowKey={(d) => d.id}
                  caption={`${formatCount(list.items.length)} newest of ${plural(list.total, "document", "documents")}`}
                  emptyMessage="No documents yet. Ingest one to see it here."
                />
              )}
            </QueryBoundary>
          </section>

          <ConfirmDialog
            open={dialog === "reindex"}
            onOpenChange={(next) => onOpenChange(next, reindex.loading)}
            title={`Reindex ${c.name}?`}
            description={REINDEX}
            confirmLabel={mayBePartial(reindex.error) ? "Run reindex again" : "Reindex"}
            pending={reindex.loading}
            onConfirm={() => void runReindex()}
          >
            <CommandAlert title="The reindex did not finish" error={reindex.error} />
            {mayBePartial(reindex.error) ? (
              <p className="text-sm">
                If it had started, this collection may now be partly indexed: some documents have their vectors back and the rest have none, so
                searches will miss the rest until a reindex finishes.
              </p>
            ) : null}
          </ConfirmDialog>

          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(next) => onOpenChange(next, remove.loading)}
            title={`Delete ${c.name}?`}
            description={`This deletes the collection with its ${plural(c.document_count, "document", "documents")} and ${plural(c.chunk_count, "chunk", "chunks")}, and their vectors. You can't undo it.`}
            confirmLabel="Delete collection"
            pending={remove.loading}
            onConfirm={() => void runDelete()}
          >
            <CommandAlert title="Could not delete the collection" error={remove.error} />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}
