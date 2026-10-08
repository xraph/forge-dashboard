import { utf8Length } from "./format"
import type { Span } from "./types"

export interface Segment {
  span: Span
  /** Percent of the bar. */
  left: number
  width: number
  /** Bytes shared with the previous chunk. */
  overlap: number
}

export interface Gap {
  start: number
  end: number
}

export interface SpanLayout {
  /** The largest end offset: the bar's full width, in bytes. */
  scale: number
  segments: Segment[]
  gaps: Gap[]
}

/**
 * Bytes `span` shares with the chunk before it. Clamped to the chunk's own
 * length, and 0 for a chunk that starts before its predecessor starts: that is
 * a fallback offset (the recursive chunker answers start 0, end len when it
 * can't place a chunk), not a real overlap.
 */
function overlapWith(prev: Span | undefined, span: Span): number {
  if (!prev || span.start_offset < prev.start_offset) return 0
  return Math.max(
    0,
    Math.min(prev.end_offset, span.end_offset) - span.start_offset
  )
}

/**
 * Chunks as byte ranges along a bar scaled to the largest end_offset, not to
 * content_length: content_length is the raw input, and once a loader has
 * changed the text the offsets are on a different scale.
 */
export function layoutSpans(spans: Span[]): SpanLayout {
  const scale = spans.reduce((m, s) => Math.max(m, s.end_offset), 0)
  if (scale === 0) return { scale: 0, segments: [], gaps: [] }
  const byIndex = [...spans].sort((a, b) => a.index - b.index)
  const segments = byIndex.map((span, i) => {
    const prev = byIndex[i - 1]
    return {
      span,
      left: (span.start_offset / scale) * 100,
      width: (Math.max(0, span.end_offset - span.start_offset) / scale) * 100,
      overlap: overlapWith(prev, span),
    }
  })
  const gaps: Gap[] = []
  let covered = 0
  for (const s of [...spans].sort((a, b) => a.start_offset - b.start_offset)) {
    if (s.start_offset > covered)
      gaps.push({ start: covered, end: s.start_offset })
    covered = Math.max(covered, s.end_offset)
  }
  return { scale, segments, gaps }
}

export function overlapsByIndex(spans: Span[]): Map<number, number> {
  return new Map(
    layoutSpans(spans).segments.map((s) => [s.span.index, s.overlap])
  )
}

/** The longest prefix of `text` that fits in `n` UTF-8 bytes, and the rest. */
export function splitAtByte(text: string, n: number): [string, string] {
  if (n <= 0) return ["", text]
  let bytes = 0
  let cut = 0
  for (const ch of text) {
    const b = utf8Length(ch)
    if (bytes + b > n) break
    bytes += b
    cut += ch.length
  }
  return [text.slice(0, cut), text.slice(cut)]
}
