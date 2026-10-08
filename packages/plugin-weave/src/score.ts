import type { Components, ScoreKind } from "./types"

const HEADERS: Record<ScoreKind, string> = {
  cosine: "Cosine",
  vector_similarity: "Similarity",
  mmr_relevance: "Cosine",
  rrf: "RRF score",
  rerank: "Rerank score",
  unknown: "Score",
}

const MEANINGS: Record<ScoreKind, string> = {
  cosine: "Cosine similarity: higher is closer. What counts as high depends on the embedding model.",
  vector_similarity: "The vector store's own similarity score. Weave can't say what scale it uses.",
  mmr_relevance: "Cosine relevance. The order is MMR, which trades some relevance for variety.",
  rrf: "A reciprocal rank fusion sum. It is not comparable to cosine.",
  rerank: "The reranker's score. The vector score is not kept.",
  unknown: "Weave can't tell what this score means.",
}

/** The ranking's score column, named for what the score is. */
export function scoreHeader(kind: ScoreKind | undefined): string {
  return HEADERS[kind ?? "unknown"] ?? HEADERS.unknown
}

export function scoreMeaning(kind: ScoreKind | undefined): string {
  return MEANINGS[kind ?? "unknown"] ?? MEANINGS.unknown
}

/** One sentence naming the configured retriever and what its scores are. */
export function retrieverSentence(c: Components): string {
  const r = c.retriever
  if (!r.configured || r.kind === "") {
    const vector = c.vector_store.score === "cosine" ? "cosine similarity" : "the vector store's own similarity"
    return `No retriever is configured, so Weave returns the vector search as it is. Scores are ${vector}.`
  }
  switch (r.kind) {
    case "mmr":
      return `MMR retriever (λ ${r.params?.lambda ?? "?"}). Scores are cosine relevance, and the order is MMR.`
    case "similarity":
      return "Similarity retriever. Scores are cosine similarity, in vector order."
    case "hybrid":
      return `Hybrid retriever (k ${r.params?.k ?? "?"}). Scores are a reciprocal rank fusion sum, not comparable to cosine.`
    case "rerank":
      return "Reranking retriever. Scores are the reranker's, and the vector score is not kept."
    case "custom":
      return "A custom retriever. Weave can't tell what its scores mean."
    default:
      return `A ${r.kind} retriever. Weave can't tell what its scores mean.`
  }
}

/**
 * Whether the deployment's retriever can reorder the vector ranking at all.
 * With none, or a plain similarity retriever, "no reordering" is a fact about
 * the deployment; otherwise it is a fact about one query.
 */
export function isReorderingRetriever(c: Components): boolean {
  return c.retriever.configured && c.retriever.kind !== "" && c.retriever.kind !== "similarity"
}
