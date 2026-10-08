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
  cosine:
    "Cosine similarity: higher is closer. What counts as high depends on the embedding model.",
  vector_similarity:
    "The vector store's own similarity score. Weave can't say what scale it uses.",
  mmr_relevance:
    "Cosine relevance. The order is MMR, which trades some relevance for variety.",
  rrf: "A reciprocal rank fusion sum. It is not comparable to cosine.",
  rerank: "The reranker's score. The vector score is not kept.",
  unknown: "Weave can't tell what this score means.",
}

const MMR_ORDER = " The order is MMR, which trades some relevance for variety."

/**
 * The ranking's score column, named for what the score is. An MMR retriever
 * passes the vector store's own score through, so its header follows
 * `vectorScore` (the store's score kind) rather than assuming cosine.
 */
export function scoreHeader(
  kind: ScoreKind | undefined,
  vectorScore?: ScoreKind
): string {
  if (kind === "mmr_relevance") {
    if (vectorScore === undefined || vectorScore === "cosine")
      return HEADERS.cosine
    if (vectorScore === "vector_similarity") return HEADERS.vector_similarity
    return HEADERS.unknown
  }
  return HEADERS[kind ?? "unknown"] ?? HEADERS.unknown
}

/** What a score means. For MMR, the meaning of the store's score, then the order. */
export function scoreMeaning(
  kind: ScoreKind | undefined,
  vectorScore?: ScoreKind
): string {
  if (kind === "mmr_relevance") {
    return (MEANINGS[vectorScore ?? "cosine"] ?? MEANINGS.unknown) + MMR_ORDER
  }
  return MEANINGS[kind ?? "unknown"] ?? MEANINGS.unknown
}

/** The vector store's score, as a phrase that reads after "Scores are". */
function storeScorePhrase(score: ScoreKind | undefined): string {
  if (score === "cosine") return "cosine similarity"
  if (score === "vector_similarity") return "the vector store's own similarity"
  return "of a kind Weave can't name"
}

function mmrPhrase(c: Components): string {
  return c.vector_store.score === "cosine"
    ? "cosine relevance"
    : storeScorePhrase(c.vector_store.score)
}

/** One sentence naming the configured retriever and what its scores are. */
export function retrieverSentence(c: Components): string {
  const r = c.retriever
  if (!r.configured || r.kind === "") {
    return `No retriever is configured, so Weave returns the vector search as it is. Scores are ${storeScorePhrase(c.vector_store.score)}.`
  }
  switch (r.kind) {
    case "mmr":
      return `MMR retriever (λ ${r.params?.lambda ?? "?"}). Scores are ${mmrPhrase(c)}, and the order is MMR.`
    case "similarity":
      return `Similarity retriever. Scores are ${storeScorePhrase(c.vector_store.score)}, in vector order.`
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
  return (
    c.retriever.configured &&
    c.retriever.kind !== "" &&
    c.retriever.kind !== "similarity"
  )
}
