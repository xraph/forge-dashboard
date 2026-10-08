import { PluginLink } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { Id } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { formatCount, formatScore, isRealTime } from "../format"
import { chunkPath, documentPath } from "../links"
import type { Hit } from "../types"
import { chunkLinkOf, documentOf, hitState } from "./model"
import { HitStateBadge, MovementCell } from "./ranking-table"

const STATE_NOTE = {
  orphaned:
    "The vector store returned this chunk ID, but Weave has no row for it. It keeps its rank because a model would still be handed its text.",
  unidentified: "The retriever returned this hit without a chunk ID, so Weave can't look it up.",
}

/** Everything about one hit. An odd hit shows what it has and nothing it doesn't. */
export function Inspector({ hit, label }: { hit: Hit; label: string }) {
  const state = hitState(hit)
  const chunkId = chunkLinkOf(hit)
  const doc = documentOf(hit)
  const hydrated = state === "hydrated" && hit.chunk !== null

  return (
    <section aria-label={label} className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">{label}</h3>
      <HitStateBadge hit={hit} />
      {state !== "hydrated" ? <p className="text-muted-foreground">{STATE_NOTE[state]}</p> : null}
      {hit.chunk ? (
        <p className="whitespace-pre-wrap rounded-md border p-2">{hit.chunk.content}</p>
      ) : (
        <p className="text-muted-foreground">This hit has no chunk, so it has no text and nothing went into the context for it.</p>
      )}
      <div className="flex flex-wrap gap-4">
        {chunkId !== "" ? (
          <PluginLink to={chunkPath(chunkId)} className="underline">
            Open the chunk
          </PluginLink>
        ) : null}
        {doc.linkable ? (
          <PluginLink to={documentPath(doc.id)} className="underline">
            Open the document
          </PluginLink>
        ) : null}
      </div>
      <DescriptionList
        items={[
          { term: "Score", value: <span className="font-mono text-xs tabular-nums">{formatScore(hit.score)}</span> },
          { term: "Vector rank", value: <MovementCell hit={hit} /> },
          {
            term: "Vector score",
            value: hit.vector_rank > 0 ? <span className="font-mono text-xs tabular-nums">{formatScore(hit.vector_score)}</span> : <NoneCell label="vector score" />,
          },
          { term: "Chunk ID", value: hit.chunk && hit.chunk.id !== "" ? <Id value={hit.chunk.id} /> : <NoneCell label="chunk ID" /> },
          { term: "Document", value: doc.id !== "" ? <Id value={doc.id} /> : <NoneCell label="document" /> },
          {
            term: "Bytes",
            value: hydrated ? (
              <span className="font-mono text-xs tabular-nums">
                {hit.chunk!.start_offset} to {hit.chunk!.end_offset}
              </span>
            ) : (
              <NoneCell label="offsets" />
            ),
          },
          { term: "Tokens", value: hydrated ? `about ${formatCount(hit.chunk!.token_count)}` : <NoneCell label="token estimate" /> },
          {
            term: "Created",
            value: hit.chunk && isRealTime(hit.chunk.created_at) ? <Timestamp value={hit.chunk.created_at} label="creation date" /> : <NoneCell label="creation date" />,
          },
        ]}
      />
      <div className="flex flex-col gap-1">
        <span className="font-medium">Metadata</span>
        <MetadataList metadata={hit.chunk?.metadata} />
      </div>
    </section>
  )
}
