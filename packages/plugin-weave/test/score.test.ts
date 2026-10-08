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

describe("scores that pass the vector store's own score through", () => {
  function onStore(retriever: Components["retriever"], score: Components["vector_store"]["score"]): Components {
    const c = components(retriever)
    return { ...c, vector_store: { ...c.vector_store, score } }
  }

  it("names an MMR header and meaning for the store's score", () => {
    expect(scoreHeader("mmr_relevance", "vector_similarity")).toBe("Similarity")
    expect(scoreHeader("mmr_relevance", "cosine")).toBe("Cosine")
    expect(scoreHeader("mmr_relevance")).toBe("Cosine")
    expect(scoreHeader("mmr_relevance", "unknown")).toBe("Score")
    expect(scoreMeaning("mmr_relevance", "vector_similarity")).toMatch(/store's own similarity.*The order is MMR/)
    expect(scoreMeaning("mmr_relevance")).toMatch(/^Cosine similarity.*The order is MMR/)
  })

  it("does not say cosine for a similarity or MMR retriever on a vector_similarity store", () => {
    const similarity = retrieverSentence(onStore({ kind: "similarity", configured: true }, "vector_similarity"))
    const mmr = retrieverSentence(onStore({ kind: "mmr", params: { lambda: "0.70" }, configured: true }, "vector_similarity"))
    expect(similarity).toBe("Similarity retriever. Scores are the vector store's own similarity, in vector order.")
    expect(mmr).toBe("MMR retriever (λ 0.70). Scores are the vector store's own similarity, and the order is MMR.")
    expect(similarity).not.toMatch(/cosine/i)
    expect(mmr).not.toMatch(/cosine/i)
  })

  it("says a store's score Weave can't name, and keeps cosine wording for a cosine store", () => {
    expect(retrieverSentence(onStore({ kind: "similarity", configured: true }, "unknown"))).toBe(
      "Similarity retriever. Scores are of a kind Weave can't name, in vector order.",
    )
    expect(retrieverSentence(onStore({ kind: "similarity", configured: true }, "cosine"))).toBe(
      "Similarity retriever. Scores are cosine similarity, in vector order.",
    )
  })
})
