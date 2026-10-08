/**
 * Wire types for the weave contract. Field names are the Go JSON tags in
 * weave/extension/contract and the engine types it returns, copied from the
 * spec's slice 3 hand-off. A field the Go side tags `omitempty` is optional
 * here: absent, never "" or 0.
 */

export type DocumentState = "pending" | "processing" | "ready" | "failed"

export interface ListOutput<T> {
  items: T[]
  total: number
  /** The limit the server applied, which is not always what was sent. */
  limit: number
  offset: number
}

export interface StateCounts {
  pending: number
  processing: number
  ready: number
  failed: number
}

export interface Collection {
  created_at: string
  updated_at: string
  id: string
  name: string
  description?: string
  tenant_id: string
  app_id: string
  /** Recorded at creation. Weave never reads it back. */
  embedding_model: string
  embedding_dims: number
  chunk_strategy: string
  chunk_size: number
  chunk_overlap: number
  metadata: Record<string, string>
  /** Live counts. The stored columns are never updated, so these shadow them. */
  document_count: number
  chunk_count: number
}

export interface CollectionDetail extends Collection {
  documents_by_state: StateCounts
  stalled: number
}

export interface DocumentRow {
  created_at: string
  updated_at: string
  id: string
  collection_id: string
  tenant_id: string
  title?: string
  source?: string
  source_type?: string
  content_hash: string
  /** Bytes of the raw input, before any loader ran. */
  content_length: number
  chunk_count: number
  metadata: Record<string, string>
  state: DocumentState
  /** The engine's raw text. It can carry backend detail. */
  error?: string
  /** "" once the collection is deleted. */
  collection_name: string
  /** Still processing 15 minutes after the last update. An age, not a verdict. */
  stalled: boolean
}

export interface Chunk {
  id: string
  document_id: string
  collection_id: string
  tenant_id: string
  content: string
  index: number
  /** Byte offsets into the text after loading and trimming. */
  start_offset: number
  end_offset: number
  /** chars/4, an estimate. */
  token_count: number
  metadata: Record<string, string>
  parent_id?: string
  created_at: string
}

/**
 * A chunk as a retrieval hit carries it. An orphaned or unidentified hit has
 * "" IDs, zero offsets and Go's zero time, and an unidentified one can have
 * null metadata.
 */
export type HitChunk = Omit<Chunk, "metadata"> & { metadata: Record<string, string> | null }

export type ScoreKind = "cosine" | "vector_similarity" | "mmr_relevance" | "rrf" | "rerank" | "unknown"

export interface ComponentInfo {
  kind: string
  params?: Record<string, string>
  score?: ScoreKind
  tenant_filter?: string
  children?: ComponentInfo[]
}

/** One wired pipeline stage. `kind` is "" when the stage is not configured. */
export interface PipelineComponent extends ComponentInfo {
  type?: string
  configured: boolean
  content_types?: string[]
  dimensions?: number
}

export interface Components {
  loader: PipelineComponent
  chunker: PipelineComponent
  embedder: PipelineComponent
  vector_store: PipelineComponent
  retriever: PipelineComponent
  score: ScoreKind
  /** "verified" or "unverified". */
  tenant_filter: string
}

export interface EngineConfig {
  default_chunk_size: number
  default_chunk_overlap: number
  default_embedding_model: string
  default_chunk_strategy: string
  default_top_k: number
  shutdown_timeout_seconds: number
}

export interface ExtensionInfo {
  name: string
  hooks: string[]
}

export interface ComponentsOutput {
  components: Components
  config: EngineConfig
  extensions: ExtensionInfo[]
}

export interface Overview {
  collections: number
  documents: number
  documents_by_state: StateCounts
  chunks: number
  stalled: number
  stalled_after_seconds: number
  newest_documents: DocumentRow[]
  components: Components
  /** Always "all": the dashboard resolves no tenant. */
  scope: string
}

export interface Span {
  id: string
  index: number
  start_offset: number
  end_offset: number
  token_count: number
}

export interface SpansOutput {
  document_id: string
  content_length: number
  spans: Span[]
  /** The real chunk count, even past the cap. */
  total: number
  complete: boolean
}

export interface IngestOutput {
  document_id: string
  state: DocumentState
  chunk_count: number
  error?: string
}

export interface ReindexOutput {
  id: string
  reindexed_documents: number
  elapsed_ms: number
}

export interface IdOutput {
  id: string
}

export interface ChunkDetail {
  chunk: Chunk
  /** "" when the document row is gone. */
  document_title: string
  /** "" when there is none. */
  previous_id: string
  next_id: string
}

/** One hit. CompareHit embeds ScoredChunk with no tag, so this is flat. */
export interface Hit {
  chunk: HitChunk | null
  score: number
  hydrated: boolean
  orphaned?: boolean
  /** 1-based; 0 for a left-out hit. */
  rank: number
  /** 1-based; 0 when the hit has no place in the raw window. */
  vector_rank: number
  vector_score: number
}

export interface CompareResult {
  hits: Hit[]
  left_out: Hit[]
  window: number
  vector_matches: number
  best_vector_score: number
  reordered: boolean
  same_search: boolean
  /** Describes `hits` only. */
  score: ScoreKind
  retriever_ms: number
  vector_ms: number
}

export interface AssembledContext {
  context: string
  total_tokens: number
  max_tokens: number
  /** Positions in the hits that were assembled. Not a prefix. */
  included: number[]
  /** -1 when everything fit. */
  first_excluded: number
  token_counter: string
}

export interface RunOutput {
  result: CompareResult
  context: AssembledContext
}

/** One hit of an earlier run, echoed to retrieval.assemble. */
export interface AssembleHit {
  chunk_id: string
  /** null for a hit that had no chunk at all. */
  content: string | null
  score: number
}
