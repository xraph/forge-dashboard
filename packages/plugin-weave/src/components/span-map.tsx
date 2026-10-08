import { PluginLink } from "@forge-go/dashboard-plugin"
import { formatBytes, formatCount, plural } from "../format"
import { chunkPath } from "../links"
import { layoutSpans } from "../spans"
import type { SpansOutput } from "../types"

/**
 * A document's chunks as byte ranges. Overlap with the previous chunk is
 * shaded, and bytes no chunk covers are marked and listed.
 */
export function SpanMap({ spans }: { spans: SpansOutput }) {
  if (spans.total === 0) return <p className="text-sm text-muted-foreground">This document has no chunks.</p>
  const layout = layoutSpans(spans.spans)
  const loaderChanged = spans.content_length !== layout.scale

  return (
    <figure className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`${plural(spans.spans.length, "chunk", "chunks")} over ${formatBytes(layout.scale)}`}
        className="relative h-8 w-full overflow-hidden rounded bg-muted"
      >
        {layout.segments.map((s, i) => (
          // PluginLink takes a className and no style, so a positioned span
          // carries the geometry and the link fills it.
          <span key={s.span.id} className="absolute top-1 h-6" style={{ left: `${s.left}%`, width: `${s.width}%` }}>
            <PluginLink
              to={chunkPath(s.span.id)}
              className={`block h-full w-full border-x border-background ${i % 2 === 0 ? "bg-primary/60" : "bg-primary/35"}`}
            >
              <span className="sr-only">
                Chunk {s.span.index}, bytes {s.span.start_offset} to {s.span.end_offset}
              </span>
            </PluginLink>
          </span>
        ))}
        {layout.segments
          .filter((s) => s.overlap > 0)
          .map((s) => (
            <span
              key={`overlap-${s.span.id}`}
              aria-hidden
              className="pointer-events-none absolute top-1 h-6 bg-foreground/25"
              style={{ left: `${s.left}%`, width: `${(s.overlap / layout.scale) * 100}%` }}
            />
          ))}
        {layout.gaps.map((g) => (
          <span
            key={`gap-${g.start}`}
            aria-hidden
            className="pointer-events-none absolute top-0 h-8 bg-destructive/60"
            style={{ left: `${(g.start / layout.scale) * 100}%`, width: `${Math.max(0.3, ((g.end - g.start) / layout.scale) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Offsets are byte offsets into the text after loading and trimming, and the semantic and code chunkers only approximate them. The
        bar runs to the last chunk's end, byte {formatCount(layout.scale)}. Shaded parts overlap the chunk before.{" "}
        {loaderChanged
          ? `The raw input was ${formatBytes(spans.content_length)}; a loader changed the text, so the two don't share a scale.`
          : null}
      </figcaption>
      {layout.gaps.map((g) => (
        <p key={`gap-text-${g.start}`} className="text-sm">
          Bytes {formatCount(g.start)} to {formatCount(g.end)} are in no chunk.
        </p>
      ))}
      {!spans.complete ? (
        <p className="text-sm">
          Showing the first {formatCount(spans.spans.length)} of {plural(spans.total, "chunk", "chunks")}.
        </p>
      ) : null}
    </figure>
  )
}
