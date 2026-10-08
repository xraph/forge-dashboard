import { describe, expect, it } from "vitest"
import { isReorderingRetriever, retrieverSentence, scoreHeader, scoreMeaning } from "../src/score"
import type { Components } from "../src/types"

function components(retriever: Components["retriever"]): Components {
  return {
    loader: { kind: "text", configured: true },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true },
    vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever,
    score: retriever.score ?? "cosine",
    tenant_filter: "verified",
  }
}

describe("scoreHeader", () => {
  it("names the column for what the score is", () => {
    expect(scoreHeader("cosine")).toBe("Cosine")
    expect(scoreHeader("mmr_relevance")).toBe("Cosine")
    expect(scoreHeader("rrf")).toBe("RRF score")
    expect(scoreHeader("rerank")).toBe("Rerank score")
    expect(scoreHeader("vector_similarity")).toBe("Similarity")
    expect(scoreHeader("unknown")).toBe("Score")
    expect(scoreHeader(undefined)).toBe("Score")
  })
})

describe("scoreMeaning", () => {
  it("says an RRF sum is not cosine and an unknown score is unknown", () => {
    expect(scoreMeaning("rrf")).toMatch(/not comparable to cosine/)
    expect(scoreMeaning("unknown")).toMatch(/can't tell/)
  })
})

describe("retrieverSentence", () => {
  it("names MMR with its lambda", () => {
    expect(retrieverSentence(components({ kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, configured: true }))).toBe(
      "MMR retriever (λ 0.70). Scores are cosine relevance, and the order is MMR.",
    )
  })

  it("says plainly when no retriever is configured", () => {
    expect(retrieverSentence(components({ kind: "", configured: false }))).toBe(
      "No retriever is configured, so Weave returns the vector search as it is. Scores are cosine similarity.",
    )
  })

  it("names hybrid with its k and a custom retriever by kind", () => {
    expect(retrieverSentence(components({ kind: "hybrid", score: "rrf", params: { k: "60" }, configured: true }))).toMatch(/^Hybrid retriever \(k 60\)/)
    expect(retrieverSentence(components({ kind: "custom", score: "unknown", configured: true }))).toBe(
      "A custom retriever. Weave can't tell what its scores mean.",
    )
  })
})

describe("isReorderingRetriever", () => {
  it("is false with no retriever or a similarity one, true otherwise", () => {
    expect(isReorderingRetriever(components({ kind: "", configured: false }))).toBe(false)
    expect(isReorderingRetriever(components({ kind: "similarity", configured: true }))).toBe(false)
    expect(isReorderingRetriever(components({ kind: "mmr", configured: true }))).toBe(true)
  })
})
