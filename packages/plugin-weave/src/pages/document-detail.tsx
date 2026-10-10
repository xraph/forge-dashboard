import { IconButton } from "@forge-go/dashboard-kit/components/icon-button"
import { useState } from "react"
import type { ComponentType } from "react"
import {
  PluginLink,
  useCommand,
  useNavigateTo,
  useQuery,
} from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@forge-go/dashboard-kit/components/alert"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import {
  CommandAlert,
  QueryBoundary,
} from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { DocumentStateCell } from "../badges"
import ChunkReader from "../components/chunk-reader"
import { Id } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { SpanMap } from "../components/span-map"
import { ageSeconds, formatAge, formatBytes, formatCount } from "../format"
import { collectionPath } from "../links"
import { overlapsByIndex } from "../spans"
import type { DocumentRow, IdOutput, SpansOutput } from "../types"

function CopyHash({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  return (
    <span className="inline-flex items-center gap-2">
      <IconButton
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setState("copied")
          } catch {
            setState("failed")
          }
        }}
        label={
          state === "copied" ? "Copied content hash" : "Copy the content hash"
        }
      />
      {state === "copied" ? (
        <span role="status" className="sr-only">
          Content hash copied
        </span>
      ) : null}
      {state === "failed" ? (
        <span role="status" className="text-xs text-destructive">
          The browser refused the clipboard. Select the hash and copy it
          yourself.
        </span>
      ) : null}
    </span>
  )
}

export const DocumentDetailPage: ComponentType<PluginPageProps> = ({
  params,
}) => {
  const id = params.id ?? ""
  const document = useQuery<DocumentRow>("documents.get", { id })
  const spans = useQuery<SpansOutput>("documents.spans", { id })
  const remove = useCommand<IdOutput>("documents.delete")
  const navigateTo = useNavigateTo()
  const [confirming, setConfirming] = useState(false)

  async function runDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    navigateTo("/documents", { replace: true })
  }

  return (
    // keepPreviousData: the delete dialog lives inside, and a refetch (a tab
    // regaining focus) must not swap in the skeleton and unmount it.
    <QueryBoundary
      title="Document"
      query={document}
      skeletonRows={8}
      keepPreviousData
    >
      {(d) => (
        <section className="flex min-w-0 flex-col gap-4">
          <PageHeader
            title={d.title ?? "Untitled document"}
            description={d.source}
            actions={
              <IconButton
                variant="destructive"
                onClick={() => {
                  remove.reset()
                  setConfirming(true)
                }}
                label="Delete"
              />
            }
          />

          {d.state === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>Ingest failed</AlertTitle>
              <AlertDescription>
                <span className="font-mono text-xs break-all">
                  {d.error ?? "Weave stored no reason."}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
          {d.stalled ? (
            <Alert>
              <AlertTitle>Looks stalled</AlertTitle>
              <AlertDescription>
                Still processing with no update for{" "}
                {formatAge(ageSeconds(d.updated_at))}. Ingest runs inside one
                request, so the process that was ingesting it has probably gone,
                but Weave has no heartbeat to say for sure. Delete it and ingest
                it again.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium">Details</h2>
            <DescriptionList
              items={[
                { term: "ID", value: <Id value={d.id} /> },
                {
                  term: "Collection",
                  value:
                    d.collection_name !== "" ? (
                      <PluginLink
                        to={collectionPath(d.collection_id)}
                        className="underline-offset-4 hover:underline"
                      >
                        {d.collection_name}
                      </PluginLink>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        deleted collection
                      </span>
                    ),
                },
                {
                  term: "Tenant",
                  value:
                    d.tenant_id !== "" ? (
                      <Id value={d.tenant_id} />
                    ) : (
                      <NoneCell label="tenant" />
                    ),
                },
                { term: "State", value: <DocumentStateCell doc={d} /> },
                {
                  term: "Content type",
                  value: d.source_type ? (
                    <Id value={d.source_type} />
                  ) : (
                    <NoneCell label="content type" />
                  ),
                },
                {
                  term: "Size",
                  value: (
                    <span>
                      <span className="font-mono text-xs">
                        {formatBytes(d.content_length)}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        of raw input, before any loader ran
                      </span>
                    </span>
                  ),
                },
                {
                  term: "Chunks",
                  value: (
                    <span className="tabular-nums">
                      {formatCount(d.chunk_count)}
                    </span>
                  ),
                },
                {
                  term: "Created",
                  value: (
                    <Timestamp value={d.created_at} label="creation date" />
                  ),
                },
                {
                  term: "Updated",
                  value: <Timestamp value={d.updated_at} label="update" />,
                },
                {
                  term: "Content hash",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <Id value={d.content_hash} />
                      <CopyHash value={d.content_hash} />
                    </span>
                  ),
                },
              ]}
            />
            <p className="text-xs text-muted-foreground">
              Weave keeps this hash and the length, never the source text.
            </p>
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium">Metadata</h2>
            <MetadataList metadata={d.metadata} />
          </section>

          <QueryBoundary title="Chunks" query={spans} skeletonRows={3}>
            {(s) => (
              <>
                <section className="flex min-w-0 flex-col gap-2">
                  <h2 className="text-sm font-medium">Where the chunks fall</h2>
                  <SpanMap spans={s} />
                </section>
                <section className="flex min-w-0 flex-col gap-2">
                  <h2 className="text-sm font-medium">Read the chunks</h2>
                  <ChunkReader
                    documentId={d.id}
                    total={s.total}
                    overlaps={overlapsByIndex(s.spans)}
                  />
                </section>
              </>
            )}
          </QueryBoundary>

          <ConfirmDialog
            open={confirming}
            onOpenChange={(next) => {
              if (!next && remove.loading) return
              setConfirming(next)
            }}
            title={`Delete ${d.title ?? "this document"}?`}
            description="This deletes the document with its chunks and their vectors. You can't undo it."
            confirmLabel="Delete document"
            pending={remove.loading}
            onConfirm={() => void runDelete()}
          >
            <CommandAlert
              title="Could not delete the document"
              error={remove.error}
            />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}

export default DocumentDetailPage
