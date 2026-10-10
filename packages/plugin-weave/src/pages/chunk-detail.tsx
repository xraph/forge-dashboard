import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { Id, IdLink } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { formatCount, isRealTime } from "../format"
import { chunkPath, collectionPath, documentPath } from "../links"
import type { ChunkDetail } from "../types"

export const ChunkDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const detail = useQuery<ChunkDetail>("chunks.get", { id })

  return (
    <QueryBoundary title="Chunk" query={detail} skeletonRows={6}>
      {({ chunk, document_title, previous_id, next_id }) => (
        <section className="flex min-w-0 flex-col gap-4">
          <PageHeader
            title={`Chunk ${chunk.index}`}
            description={
              document_title !== ""
                ? `Of ${document_title}`
                : "Its document is untitled or has been deleted. Open it to find out."
            }
          />
          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium">Text</h2>
            <p className="rounded-md border p-3 text-sm whitespace-pre-wrap">
              {chunk.content}
            </p>
          </section>
          <DescriptionList
            items={[
              { term: "ID", value: <Id value={chunk.id} /> },
              {
                term: "Document",
                value: (
                  <span className="flex flex-wrap items-center gap-2">
                    <IdLink
                      to={documentPath(chunk.document_id)}
                      value={chunk.document_id}
                    />
                    {document_title !== "" ? (
                      <span className="text-sm font-medium">
                        {document_title}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        untitled, or deleted
                      </span>
                    )}
                  </span>
                ),
              },
              {
                term: "Collection",
                value: (
                  <IdLink
                    to={collectionPath(chunk.collection_id)}
                    value={chunk.collection_id}
                  />
                ),
              },
              {
                term: "Tenant",
                value:
                  chunk.tenant_id !== "" ? (
                    <Id value={chunk.tenant_id} />
                  ) : (
                    <NoneCell label="tenant" />
                  ),
              },
              {
                term: "Position",
                value: <span className="tabular-nums">{chunk.index}</span>,
              },
              {
                term: "Bytes",
                value: (
                  <span className="font-mono text-xs tabular-nums">
                    {chunk.start_offset} to {chunk.end_offset}
                  </span>
                ),
              },
              {
                term: "Tokens",
                value: `about ${formatCount(chunk.token_count)} tokens (characters ÷ 4)`,
              },
              {
                term: "Created",
                value: isRealTime(chunk.created_at) ? (
                  <Timestamp value={chunk.created_at} label="creation date" />
                ) : (
                  <NoneCell label="creation date" />
                ),
              },
              ...(chunk.parent_id
                ? [{ term: "Parent", value: <Id value={chunk.parent_id} /> }]
                : []),
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Byte offsets into the text after loading and trimming. The semantic
            and code chunkers only approximate them.
          </p>
          <section className="flex min-w-0 flex-col gap-2">
            <h2 className="text-sm font-medium">Metadata</h2>
            <MetadataList metadata={chunk.metadata} />
          </section>
          <nav className="flex gap-4 text-sm" aria-label="Neighbouring chunks">
            {previous_id !== "" ? (
              <PluginLink to={chunkPath(previous_id)} className="underline">
                Previous chunk
              </PluginLink>
            ) : (
              <NoneCell label="previous chunk" />
            )}
            {next_id !== "" ? (
              <PluginLink to={chunkPath(next_id)} className="underline">
                Next chunk
              </PluginLink>
            ) : (
              <NoneCell label="next chunk" />
            )}
          </nav>
        </section>
      )}
    </QueryBoundary>
  )
}
