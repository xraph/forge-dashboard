import { describe, expect, it } from "vitest"
import {
  assembleHitsFrom,
  chunkLinkOf,
  contextParts,
  documentOf,
  emptiness,
  emptinessCopy,
  hitForMarker,
  hitState,
  movement,
  noReorderingCopy,
} from "../src/retrieval/model"
import type { CompareResult, Components, Hit, HitChunk } from "../src/types"

const ZERO = "0001-01-01T00:00:00Z"

function chunk(over: Partial<HitChunk> = {}): HitChunk {
  return {
    id: "chk_01k70000000000000000000100", document_id: "doc_01k70000000000000000000001", collection_id: "col_01k70000000000000000000001",
    tenant_id: "", content: "Refunds take 14 days.", index: 0, start_offset: 0, end_offset: 21, token_count: 5,
    metadata: { document_id: "doc_01k70000000000000000000001" }, created_at: "2026-10-04T09:00:00Z", ...over,
  }
}

const hydrated: Hit = { chunk: chunk(), score: 0.83, hydrated: true, rank: 1, vector_rank: 1, vector_score: 0.83 }
const orphan: Hit = {
  chunk: chunk({ id: "chk_01k70000000000000000000901", document_id: "", collection_id: "", index: 0, start_offset: 0, end_offset: 0, token_count: 0, created_at: ZERO, metadata: { document_id: "doc_01k70000000000000000000099" } }),
  score: 0.79, hydrated: false, orphaned: true, rank: 2, vector_rank: 3, vector_score: 0.79,
}
const unidentified: Hit = { chunk: null, score: 0.7, hydrated: false, rank: 3, vector_rank: 0, vector_score: 0 }

function result(over: Partial<CompareResult> = {}): CompareResult {
  return {
    hits: [hydrated], left_out: [], window: 50, vector_matches: 23, best_vector_score: 0.861,
    reordered: false, same_search: false, score: "mmr_relevance", retriever_ms: 412, vector_ms: 120, ...over,
  }
}

function components(kind: string, configured = true): Components {
  return {
    loader: { kind: "text", configured: true }, chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true }, vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever: { kind, configured }, score: "cosine", tenant_filter: "verified",
  }
}

describe("hitState", () => {
  it("tells the three kinds of hit apart", () => {
    expect(hitState(hydrated)).toBe("hydrated")
    expect(hitState(orphan)).toBe("orphaned")
    expect(hitState(unidentified)).toBe("unidentified")
  })
})

describe("links", () => {
  it("links only a hydrated hit to its chunk", () => {
    expect(chunkLinkOf(hydrated)).toBe("chk_01k70000000000000000000100")
    expect(chunkLinkOf(orphan)).toBe("")
    expect(chunkLinkOf(unidentified)).toBe("")
  })

  it("reads an orphan's document from the vector metadata, and never links it", () => {
    expect(documentOf(hydrated)).toEqual({ id: "doc_01k70000000000000000000001", linkable: true })
    expect(documentOf(orphan)).toEqual({ id: "doc_01k70000000000000000000099", linkable: false })
    expect(documentOf(unidentified)).toEqual({ id: "", linkable: false })
  })
})

describe("movement", () => {
  it("compares the final rank with the vector rank", () => {
    expect(movement({ ...hydrated, rank: 2, vector_rank: 7 })).toEqual({ kind: "up", by: 5 })
    expect(movement({ ...hydrated, rank: 7, vector_rank: 4 })).toEqual({ kind: "down", by: 3 })
    expect(movement(hydrated)).toEqual({ kind: "same", by: 0 })
    expect(movement(unidentified)).toEqual({ kind: "outside", by: 0 })
  })
})

describe("assembleHitsFrom", () => {
  it("echoes every hit in order, and sends null content for a hit with no chunk", () => {
    expect(assembleHitsFrom([hydrated, orphan, unidentified])).toEqual([
      { chunk_id: "chk_01k70000000000000000000100", content: "Refunds take 14 days.", score: 0.83 },
      { chunk_id: "chk_01k70000000000000000000901", content: "Refunds take 14 days.", score: 0.79 },
      { chunk_id: "", content: null, score: 0.7 },
    ])
  })
})

describe("emptiness", () => {
  it("is null when there are hits", () => {
    expect(emptiness(result(), 0)).toBeNull()
  })

  it("says vector search found nothing", () => {
    const e = emptiness(result({ hits: [], vector_matches: 0, best_vector_score: 0 }), 0)
    expect(e).toEqual({ kind: "no-vectors" })
    expect(emptinessCopy(e!)).toMatch(/Vector search found nothing/)
  })

  it("blames the min score when the best match was under it", () => {
    const e = emptiness(result({ hits: [] }), 0.9)
    expect(emptinessCopy(e!)).toBe("Min score 0.9 removed all 23 vector matches; the best was 0.861.")
  })

  it("says the retriever returned none when the min score was not the cause", () => {
    const e = emptiness(result({ hits: [] }), 0)
    expect(emptinessCopy(e!)).toBe("Vector search found 23 matches and the retriever returned none of them.")
  })
})

describe("noReorderingCopy", () => {
  it("is null when something moved", () => {
    expect(noReorderingCopy(result({ reordered: true }), components("mmr"))).toBeNull()
  })

  it("speaks about the deployment when nothing could move", () => {
    const copy = "No reordering: this deployment returns the vector ranking as it is."
    expect(noReorderingCopy(result({ same_search: true }), components("", false))).toBe(copy)
    expect(noReorderingCopy(result(), components("similarity"))).toBe(copy)
  })

  it("speaks about the query when a reordering retriever happened not to move anything", () => {
    expect(noReorderingCopy(result(), components("mmr"))).toBe("No reordering for this query: it came back in vector order. The next query may not.")
  })
})

describe("contextParts", () => {
  it("splits Weave's context into its header, markers and text", () => {
    const parts = contextParts("Relevant context:\n\n[1] Refunds take 14 days.\n\n---\n\n[2] Express arrives tomorrow.")
    expect(parts).toEqual([
      { kind: "text", text: "Relevant context:\n\n" },
      { kind: "marker", n: 1 },
      { kind: "text", text: "Refunds take 14 days." },
      { kind: "text", text: "\n\n---\n\n" },
      { kind: "marker", n: 2 },
      { kind: "text", text: "Express arrives tomorrow." },
    ])
  })

  it("leaves a [n] inside a chunk's own text alone", () => {
    expect(contextParts("[1] See note [3] below.")).toEqual([{ kind: "marker", n: 1 }, { kind: "text", text: "See note [3] below." }])
  })

  it("keeps the header alone when nothing fit, and has no parts for an empty string", () => {
    expect(contextParts("Relevant context:\n\n")).toEqual([{ kind: "text", text: "Relevant context:\n\n" }])
    expect(contextParts("")).toEqual([])
  })
})

describe("hitForMarker", () => {
  it("maps marker n to included[n-1], which is not a prefix", () => {
    const context = { context: "", total_tokens: 0, max_tokens: 4096, included: [0, 2, 4], first_excluded: 1, token_counter: "chars/4" }
    expect(hitForMarker(context, 2)).toBe(2)
    expect(hitForMarker(context, 3)).toBe(4)
    expect(hitForMarker(context, 9)).toBe(-1)
  })
})
