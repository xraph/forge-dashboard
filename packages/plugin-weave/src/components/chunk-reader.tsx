import { useRef } from "react"
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { formatCount } from "../format"
import { chunkPath } from "../links"
import { splitAtByte } from "../spans"
import type { Chunk, ListOutput } from "../types"

const PAGE = 100
const ROW_HEIGHT = 112
const INITIAL_RECT = { width: 0, height: 512 }

/**
 * One chunk, read from the page of 100 it belongs to. Every row on a page
 * asks the same question, so the shared query store sends one request per
 * page, and only for the pages you scroll to.
 */
function ChunkRow({ documentId, index, overlap }: { documentId: string; index: number; overlap: number }) {
  const offset = Math.floor(index / PAGE) * PAGE
  const page = useQuery<ListOutput<Chunk>>("chunks.list", { document_id: documentId, limit: PAGE, offset })
  if (page.error) return <p className="py-2 text-sm text-destructive">{page.error.message}</p>
  const chunk = page.data?.items[index - offset]
  if (!chunk) return <div aria-busy="true" className="my-2 h-16 animate-pulse rounded bg-muted" />
  const [shared, rest] = splitAtByte(chunk.content, overlap)
  return (
    <article className="flex flex-col gap-1 border-b py-2">
      <header className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <PluginLink to={chunkPath(chunk.id)} className="font-mono text-xs underline-offset-4 hover:underline">
          #{chunk.index}
        </PluginLink>
        <span className="font-mono">
          bytes {formatCount(chunk.start_offset)} to {formatCount(chunk.end_offset)}
        </span>
        <span>about {formatCount(chunk.token_count)} tokens</span>
      </header>
      <p className="whitespace-pre-wrap text-sm">
        {shared !== "" ? (
          <mark title="Overlaps the previous chunk" className="rounded-sm bg-muted px-0.5 text-foreground">
            {shared}
          </mark>
        ) : null}
        {rest}
      </p>
    </article>
  )
}

/** Every chunk's full text in order, virtualised, with overlap highlighted. */
export default function ChunkReader({ documentId, total, overlaps }: { documentId: string; total: number; overlaps: Map<number, number> }) {
  const scroller = useRef<HTMLDivElement>(null)
  // The React Compiler skips memoising this component, which is what it should do with this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
    initialRect: INITIAL_RECT,
    // jsdom answers a height of 0 once the scroller mounts, which would leave
    // no rows at all. A real reader is never 0 tall, so keep the start size.
    observeElementRect: (instance, cb) => observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : INITIAL_RECT)),
    // The same goes for each row: jsdom measures every row as 0 tall, so all
    // 7,000 of a long document would fit the window and render at once. A real
    // row is never 0 tall (the placeholder alone is 4.5rem), so a 0 keeps the
    // estimate.
    measureElement: (element, entry) => {
      const measured = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height
      return measured > 0 ? Math.round(measured) : ROW_HEIGHT
    },
  })

  if (total === 0) return <p className="text-sm text-muted-foreground">No chunks to read.</p>

  return (
    <div ref={scroller} className="h-[32rem] overflow-auto rounded-md border px-3" aria-label="Chunk reader">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
          >
            <ChunkRow documentId={documentId} index={item.index} overlap={overlaps.get(item.index) ?? 0} />
          </div>
        ))}
      </div>
    </div>
  )
}
