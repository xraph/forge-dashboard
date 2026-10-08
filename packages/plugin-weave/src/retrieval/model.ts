import { isReorderingRetriever } from "../score"
import type {
  AssembleHit,
  AssembledContext,
  CompareResult,
  Components,
  Hit,
} from "../types"

export type HitState = "hydrated" | "orphaned" | "unidentified"

/**
 * Hydrated is the normal hit. Orphaned: the vector store returned a chunk ID
 * with no row behind it. Unidentified: a custom retriever set no chunk ID, or
 * returned no chunk at all. Both odd kinds keep their rank on the page.
 */
export function hitState(hit: Hit): HitState {
  if (hit.hydrated) return "hydrated"
  return hit.orphaned ? "orphaned" : "unidentified"
}

/** The chunk page to open, or "" when there isn't one. An orphan's ID names a row that doesn't exist. */
export function chunkLinkOf(hit: Hit): string {
  return hit.hydrated && hit.chunk && hit.chunk.id !== "" ? hit.chunk.id : ""
}

/**
 * The document a hit came from. A hydrated hit has the row's own field. An
 * orphan has only the vector store's metadata key, which may name a document
 * that is gone, so it is shown and never linked.
 */
export function documentOf(hit: Hit): { id: string; linkable: boolean } {
  if (!hit.chunk) return { id: "", linkable: false }
  if (hit.hydrated && hit.chunk.document_id !== "")
    return { id: hit.chunk.document_id, linkable: true }
  return { id: hit.chunk.metadata?.document_id ?? "", linkable: false }
}

export interface Movement {
  kind: "same" | "up" | "down" | "outside"
  by: number
}

/** How far the retriever moved a hit from its place in the raw vector ranking. */
export function movement(hit: Hit): Movement {
  if (hit.vector_rank === 0) return { kind: "outside", by: 0 }
  const delta = hit.vector_rank - hit.rank
  if (delta > 0) return { kind: "up", by: delta }
  if (delta < 0) return { kind: "down", by: -delta }
  return { kind: "same", by: 0 }
}

/**
 * The run's hits as retrieval.assemble takes them, in the run's order. A hit
 * with no chunk sends content null, so re-assembly skips it as the run did;
 * "" would add an empty [n] and shift every marker after it.
 */
export function assembleHitsFrom(hits: Hit[]): AssembleHit[] {
  return hits.map((h) => ({
    chunk_id: h.chunk?.id ?? "",
    content: h.chunk ? h.chunk.content : null,
    score: h.score,
  }))
}

export type Emptiness =
  | { kind: "no-vectors" }
  | { kind: "all-filtered"; matches: number; best: number; minScore: number }
  | { kind: "none-returned"; matches: number }

/** Which kind of empty a run is, or null when it has hits. */
export function emptiness(
  result: CompareResult,
  minScore: number
): Emptiness | null {
  if (result.hits.length > 0) return null
  if (result.vector_matches === 0) return { kind: "no-vectors" }
  if (minScore > 0 && result.best_vector_score < minScore) {
    return {
      kind: "all-filtered",
      matches: result.vector_matches,
      best: result.best_vector_score,
      minScore,
    }
  }
  return { kind: "none-returned", matches: result.vector_matches }
}

export function emptinessCopy(e: Emptiness): string {
  switch (e.kind) {
    case "no-vectors":
      return "Vector search found nothing. This collection has no vectors yet, or the tenant filter excludes every one."
    case "all-filtered":
      return `Min score ${e.minScore} removed all ${e.matches} vector matches; the best was ${e.best.toFixed(3)}.`
    case "none-returned":
      return `Vector search found ${e.matches} matches and the retriever returned none of them.`
  }
}

/**
 * What to say when the final ranking is the vector ranking. If nothing could
 * have moved (no retriever, or plain similarity), it is a fact about the
 * deployment. If a reordering retriever happened to keep vector order, it is
 * a fact about this query only.
 */
export function noReorderingCopy(
  result: CompareResult,
  components: Components | undefined
): string | null {
  if (result.reordered) return null
  if (
    result.same_search ||
    (components !== undefined && !isReorderingRetriever(components))
  ) {
    return "No reordering: this deployment returns the vector ranking as it is."
  }
  return "No reordering for this query: it came back in vector order. The next query may not."
}

/**
 * Weave's default template (assembler/template.go) writes this header first,
 * every time, even when nothing fit, then joins "[n] content" blocks with the
 * separator. The header's bytes are not in total_tokens.
 */
export const CONTEXT_HEADER = "Relevant context:\n\n"
export const CONTEXT_SEPARATOR = "\n\n---\n\n"

export type ContextPart =
  { kind: "text"; text: string } | { kind: "marker"; n: number }

/**
 * The assembled context as text and markers. A marker is "[n] " at the start
 * of a block, never a "[n]" inside a chunk's own text. The default header is
 * its own text part, so the first block's marker is still found.
 */
export function contextParts(context: string): ContextPart[] {
  if (context === "") return []
  const out: ContextPart[] = []
  let body = context
  if (body.startsWith(CONTEXT_HEADER)) {
    out.push({ kind: "text", text: CONTEXT_HEADER })
    body = body.slice(CONTEXT_HEADER.length)
    if (body === "") return out
  }
  body.split(CONTEXT_SEPARATOR).forEach((block, i) => {
    if (i > 0) out.push({ kind: "text", text: CONTEXT_SEPARATOR })
    const m = /^\[(\d+)\] /.exec(block)
    if (m) {
      out.push({ kind: "marker", n: Number(m[1]) })
      out.push({ kind: "text", text: block.slice(m[0].length) })
    } else {
      out.push({ kind: "text", text: block })
    }
  })
  return out
}

/** Marker [n] is hit included[n-1]. -1 when the marker names nothing. */
export function hitForMarker(context: AssembledContext, n: number): number {
  return context.included[n - 1] ?? -1
}
