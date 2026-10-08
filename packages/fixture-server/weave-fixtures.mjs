// weave-fixtures.mjs: in-memory state and intent handlers for the weave
// contributor (packages/plugin-weave). Mirrors forgery/weave
// extension/contract at 5495ebb: field names are the Go JSON tags and every
// refusal uses the Go text.
//
// Self-contained: it imports nothing from server.mjs. server.mjs hands over
// its FixtureError class, because the dispatcher tells a refusal from a crash
// with `instanceof` and a second copy of the class would never match.
//
// Where this differs from the real server, on purpose:
// - Scores come from word overlap with the query, not from embeddings. The
//   "mmr" retriever is a greedy pick that penalises a second hit from the
//   same document. Both exist to produce a reordering, a left-out list, an
//   orphaned hit and a budget cut-off for the page to draw, not to rank well.
// - Chunking is a fixed window of chunk_size*4 characters stepping by
//   (chunk_size - chunk_overlap)*4. Offsets are UTF-8 byte offsets into the
//   trimmed text, as Weave's are.
// - One chunk of "Shipping FAQ" is trimmed by 48 characters, so the span map
//   has a gap to draw. Weave's semantic and code chunkers only approximate
//   their offsets, so a gap is a real thing to meet.
// - Ingesting content that contains FIXTURE_FAIL_EMBED answers state failed
//   with an embedder error, so the failed path can be walked.
// - Token counts are bytes/4 and the assembler joins "[n] content" with
//   "\n\n---\n\n", as Weave's default template does, without counting the
//   template's own bytes.
//
// Switches, read on every call so a running server can be flipped:
//   FIXTURE_WEAVE_EMBEDDER   "none" takes the embedder away: retrieval,
//                            ingest and reindex answer UNAVAILABLE.
//   FIXTURE_WEAVE_RETRIEVER  "none" takes the retriever away: both sides of a
//                            run are the same vector search.
//   FIXTURE_WEAVE_REINDEX    "fail" makes every reindex answer INTERNAL after
//                            it started, leaving the collection partly
//                            indexed as far as the page can tell.

import { createHash } from "node:crypto"

const MIB = 1024 * 1024
const ZERO_TIME = "0001-01-01T00:00:00Z"
const STALLED_AFTER_SECONDS = 900
const SPAN_CAP = 5000
const DUPLICATE =
  "this collection already has a document with exactly the same content (including a failed or stalled one; delete it to ingest again)"
const STATES = ["pending", "processing", "ready", "failed"]

const B32 = "0123456789abcdefghjkmnpqrstvwxyz"
function b32(n) {
  let s = ""
  do {
    s = B32[n % 32] + s
    n = Math.floor(n / 32)
  } while (n > 0)
  return s
}

/** A TypeID-shaped ID: prefix, underscore, 26 base32 characters. */
export function idOf(prefix, n) {
  return `${prefix}_01k7${b32(n).padStart(22, "0")}`
}

const ID_PATTERN = /^(col|doc|chk)_[0-7][0-9a-hjkmnp-tv-z]{25}$/

export const WEAVE_IDS = {
  support: idOf("col", 1),
  handbook: idOf("col", 2),
  scratch: idOf("col", 3),
  refund: idOf("doc", 1),
  shipping: idOf("doc", 2),
  warranty: idOf("doc", 3),
  oldImport: idOf("doc", 4),
  draft: idOf("doc", 5),
  onboarding: idOf("doc", 6),
  goneDocument: idOf("doc", 99),
  /** The first chunk of "Refund policy". Seeded chunks count up from 100. */
  firstChunk: idOf("chk", 100),
  /** A chunk row whose document row is gone. */
  orphanChunk: idOf("chk", 900),
  /** A vector with no chunk row at all. */
  orphanVector: idOf("chk", 901),
  missingCollection: idOf("col", 777),
  missingDocument: idOf("doc", 777),
  missingChunk: idOf("chk", 777),
}
const I = WEAVE_IDS

const REFUND = [
  "Refunds are issued within 14 days of the return reaching our warehouse.",
  "The money goes back to the card or account you paid with.",
  "If you paid with a gift card, the refund arrives as store credit.",
  "Shipping costs are refunded only when the item arrived damaged or was not what you ordered.",
  "A refund for an order paid in instalments cancels the instalments you have not paid yet.",
  "If the order shipped in more than one parcel, each parcel is refunded on its own once it arrives back.",
  "We email you when the refund is issued, with the amount and the date it should reach you.",
].join(" ")

const SHIPPING_TEXT = [
  "Standard shipping takes three to five working days inside the country.",
  "Express shipping arrives the next working day when you order before 2 pm.",
  "We ship to forty countries, and customs charges outside the country are paid by the recipient.",
  "Every parcel has a tracking link, sent by email when it leaves the warehouse.",
  "If the tracking link shows no movement for five days, contact support and we open an investigation with the carrier.",
  "Orders over 50 euros ship free.",
].join(" ")
const SHIPPING_HTML = `<html><head><title>Shipping</title></head><body><h1>Shipping</h1><p>${SHIPPING_TEXT}</p></body></html>`

const WARRANTY = [
  "Every product carries a two year warranty against manufacturing defects.",
  "The warranty does not cover wear, accidents or repairs made by someone else.",
  "To claim, send a photo of the fault and your order number to support.",
  "We repair or replace the item, and if neither is possible we refund it.",
].join(" ")

const ONBOARDING = [
  "New starters get a laptop, an access badge and a buddy on their first day.",
  "The buddy walks you through the support tools and sits in on your first ten tickets.",
  "In your first week you read the refund, shipping and warranty policies, because most tickets ask about one of them.",
  "By the end of the first month you handle tickets alone and review one colleague's replies each week.",
].join(" ")

const bytes = (s) => Buffer.byteLength(s, "utf8")
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex")
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")

function envOff(name, value) {
  return (process.env[name] ?? "") === value
}

const config = {
  default_chunk_size: 512,
  default_chunk_overlap: 50,
  default_embedding_model: "text-embedding-3-small",
  default_chunk_strategy: "recursive",
  default_top_k: 10,
  shutdown_timeout_seconds: 30,
}

/** Fixed windows over the trimmed text, with UTF-8 byte offsets. */
function chunkText(text, size, overlap) {
  const width = size * 4
  const step = Math.max(1, (size - overlap) * 4)
  const out = []
  for (let start = 0; start < text.length; start += step) {
    const piece = text.slice(start, start + width)
    const startByte = bytes(text.slice(0, start))
    out.push({
      content: piece,
      start_offset: startByte,
      end_offset: startByte + bytes(piece),
      token_count: Math.floor(bytes(piece) / 4),
    })
    if (start + width >= text.length) break
  }
  return out
}

let state
let serial

function seed() {
  const now = Date.now()
  const ago = (minutes) => iso(now - minutes * 60_000)
  serial = 1000
  let chunkSerial = 100
  const s = { collections: new Map(), documents: new Map(), chunks: new Map(), vectors: new Map() }

  const collection = (id, fields) => {
    s.collections.set(id, {
      id,
      name: fields.name,
      ...(fields.description ? { description: fields.description } : {}),
      tenant_id: fields.tenant_id ?? "",
      app_id: fields.app_id ?? "",
      embedding_model: config.default_embedding_model,
      embedding_dims: 1536,
      chunk_strategy: config.default_chunk_strategy,
      chunk_size: fields.chunk_size,
      chunk_overlap: fields.chunk_overlap,
      metadata: fields.metadata ?? {},
      created_at: ago(fields.age),
      updated_at: ago(fields.age),
    })
  }
  collection(I.support, { name: "support-articles", description: "Help centre articles the support assistant answers from.", chunk_size: 48, chunk_overlap: 8, metadata: { team: "support" }, age: 60 * 24 * 30 })
  collection(I.handbook, { name: "acme-handbook", tenant_id: "acme", app_id: "acme-app", chunk_size: 64, chunk_overlap: 0, age: 60 * 24 * 12 })
  collection(I.scratch, { name: "scratch", chunk_size: 512, chunk_overlap: 50, age: 60 * 24 * 2 })

  const addChunks = (doc, text, { vectors = true, trim } = {}) => {
    const col = s.collections.get(doc.collection_id)
    const pieces = chunkText(text, col.chunk_size, col.chunk_overlap)
    if (trim) {
      const p = pieces[trim.index]
      const kept = p.content.slice(0, p.content.length - trim.chars)
      p.end_offset = p.start_offset + bytes(kept)
      p.content = kept
      p.token_count = Math.floor(bytes(kept) / 4)
    }
    pieces.forEach((p, index) => {
      const id = idOf("chk", chunkSerial++)
      const row = { id, document_id: doc.id, collection_id: doc.collection_id, tenant_id: doc.tenant_id, ...p, index, metadata: {}, created_at: doc.created_at }
      s.chunks.set(id, row)
      if (vectors) s.vectors.set(id, vectorOf(row))
    })
    return pieces.length
  }

  const document = (id, fields, text, opts) => {
    const col = s.collections.get(fields.collection_id)
    const doc = {
      id,
      collection_id: fields.collection_id,
      tenant_id: col.tenant_id,
      ...(fields.title ? { title: fields.title } : {}),
      ...(fields.source ? { source: fields.source } : {}),
      ...(fields.source_type ? { source_type: fields.source_type } : {}),
      content_hash: sha256(fields.raw ?? text ?? id),
      content_length: fields.content_length ?? bytes(fields.raw ?? text ?? ""),
      chunk_count: 0,
      metadata: fields.metadata ?? {},
      state: fields.state,
      ...(fields.error ? { error: fields.error } : {}),
      created_at: ago(fields.age),
      updated_at: ago(fields.updated ?? fields.age),
    }
    s.documents.set(id, doc)
    if (text) {
      const n = addChunks(doc, text, opts)
      if (doc.state === "ready") doc.chunk_count = n
    }
  }

  // Order matters: chunk IDs count up from 100, and WEAVE_IDS.firstChunk is
  // the first chunk of the first document seeded.
  document(I.refund, { collection_id: I.support, title: "Refund policy", source: "https://help.example.com/refunds", source_type: "text/plain", metadata: { lang: "en", owner: "support" }, state: "ready", age: 60 * 24 * 3 }, REFUND)
  document(I.shipping, { collection_id: I.support, title: "Shipping FAQ", source: "https://help.example.com/shipping.html", source_type: "text/html", raw: SHIPPING_HTML, metadata: { lang: "en" }, state: "ready", age: 60 * 24 * 2 }, SHIPPING_TEXT, { trim: { index: 1, chars: 48 } })
  // A vector upsert failure leaves the chunk rows and marks the document failed.
  document(I.warranty, { collection_id: I.support, title: "Warranty terms", source_type: "text/plain", state: "failed", error: "vector upsert: dial tcp 10.0.4.12:6333: connect: connection refused", age: 60 * 26 }, WARRANTY, { vectors: false })
  document(I.oldImport, { collection_id: I.support, title: "Returns archive 2019", source_type: "text/csv", content_length: 48213, state: "processing", age: 60 * 3, updated: 60 * 3 })
  document(I.draft, { collection_id: I.support, title: "Holiday hours", content_length: 1880, state: "pending", age: 2 })
  document(I.onboarding, { collection_id: I.handbook, title: "Onboarding", source: "handbook/onboarding.md", source_type: "text/markdown", state: "ready", age: 60 * 24 * 10 }, ONBOARDING)

  // A chunk row whose document row is gone. chunks.get opens it with an empty
  // document_title; its vector still answers searches.
  const orphanRow = {
    id: I.orphanChunk, document_id: I.goneDocument, collection_id: I.support, tenant_id: "",
    content: "Store credit never expires and can be spent on anything in the shop.",
    index: 0, start_offset: 0, end_offset: 68, token_count: 17, metadata: {}, created_at: ago(60 * 24 * 20),
  }
  s.chunks.set(orphanRow.id, orphanRow)
  s.vectors.set(orphanRow.id, vectorOf(orphanRow))
  // A vector with no chunk row at all: the hit keeps its rank and is orphaned.
  s.vectors.set(I.orphanVector, {
    id: I.orphanVector,
    content: "Gift card refunds are paid as store credit within 14 days, and the credit never expires.",
    metadata: { collection_id: I.support, document_id: I.goneDocument, tenant_id: "", chunk_index: "1" },
  })
  return s
}

function vectorOf(row) {
  return {
    id: row.id,
    content: row.content,
    metadata: { collection_id: row.collection_id, document_id: row.document_id, tenant_id: row.tenant_id, chunk_index: String(row.index) },
  }
}

state = seed()

export function resetWeave() {
  state = seed()
}

export function createWeaveHandlers(FixtureError) {
  const badRequest = (m) => new FixtureError(400, "BAD_REQUEST", m)
  const notFound = (m) => new FixtureError(404, "NOT_FOUND", m)
  const conflict = (m) => new FixtureError(409, "CONFLICT", m)
  const unavailable = (m) => new FixtureError(503, "UNAVAILABLE", m)
  const internal = () => new FixtureError(500, "INTERNAL", "an internal error occurred")

  const noEmbedder = () => envOff("FIXTURE_WEAVE_EMBEDDER", "none")
  const noRetriever = () => envOff("FIXTURE_WEAVE_RETRIEVER", "none")

  const intOf = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0)

  function page(input) {
    const limit = intOf(input?.limit)
    const offset = intOf(input?.offset)
    if (limit < 0 || offset < 0) throw badRequest("limit and offset cannot be negative")
    return { limit: limit === 0 ? 25 : Math.min(limit, 100), offset }
  }

  function list(rows, input) {
    const { limit, offset } = page(input)
    return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }
  }

  /** null is every tenant; a string, "" included, is an exact match. */
  const tenantOf = (input) => (input?.tenant === undefined || input?.tenant === null ? null : String(input.tenant))
  const inTenant = (row, tenant) => tenant === null || row.tenant_id === tenant

  const NOUN = { col: "collection", doc: "document", chk: "chunk" }
  function parseId(prefix, field, value) {
    if (typeof value !== "string" || value.trim() === "") throw badRequest(`${field} is required`)
    if (!ID_PATTERN.test(value) || !value.startsWith(`${prefix}_`)) throw badRequest(`${field} is not a ${NOUN[prefix]} ID`)
    return value
  }
  const optionalId = (prefix, field, value) => (value === undefined || value === null || value === "" ? "" : parseId(prefix, field, value))

  const newest = (a, b) => (a.created_at === b.created_at ? (a.id < b.id ? 1 : -1) : a.created_at < b.created_at ? 1 : -1)

  function isStalled(d) {
    return d.state === "processing" && Date.now() - Date.parse(d.updated_at) > STALLED_AFTER_SECONDS * 1000
  }

  function documentRow(d) {
    return { ...d, metadata: { ...d.metadata }, collection_name: state.collections.get(d.collection_id)?.name ?? "", stalled: isStalled(d) }
  }

  function collectionRow(c) {
    const docs = [...state.documents.values()].filter((d) => d.collection_id === c.id)
    const chunks = [...state.chunks.values()].filter((k) => k.collection_id === c.id)
    return { ...c, metadata: { ...c.metadata }, document_count: docs.length, chunk_count: chunks.length }
  }

  function countStates(docs) {
    const out = { pending: 0, processing: 0, ready: 0, failed: 0 }
    for (const d of docs) out[d.state] += 1
    return out
  }

  function components() {
    const unconfigured = { kind: "", configured: false }
    return {
      loader: {
        kind: "text",
        type: "*loader.TextLoader",
        configured: true,
        content_types: ["text/plain", "text/markdown", "text/x-markdown", "text/html", "application/xhtml+xml", "text/csv", "application/json"],
      },
      chunker: { kind: "recursive", type: "*chunker.RecursiveChunker", configured: true },
      embedder: noEmbedder()
        ? unconfigured
        : { kind: "openai", params: { model: "text-embedding-3-small" }, type: "*embedder.OpenAIEmbedder", configured: true, dimensions: 1536 },
      vector_store: { kind: "memory", score: "cosine", tenant_filter: "verified", type: "*memory.Store", configured: true },
      retriever: noRetriever()
        ? unconfigured
        : { kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, type: "*retriever.MMRRetriever", configured: true },
      score: noRetriever() ? "cosine" : "mmr_relevance",
      tenant_filter: "verified",
    }
  }

  function words(text) {
    return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
  }

  function similarity(query, text, id) {
    const q = words(query)
    if (q.size === 0) return 0.42
    const t = words(text)
    let hit = 0
    for (const w of q) if (t.has(w)) hit += 1
    const jitter = (parseInt(createHash("sha1").update(id).digest("hex").slice(0, 4), 16) % 97) / 10000
    return Math.round((0.42 + 0.45 * (hit / q.size) + jitter) * 10000) / 10000
  }

  /** A hit as the engine hydrates it: the row with the vector's keys merged under its own. */
  function hydrate(v, score) {
    const row = state.chunks.get(v.id)
    if (row) return { chunk: { ...row, metadata: { ...v.metadata, ...row.metadata } }, score, hydrated: true }
    return {
      chunk: {
        id: v.id, document_id: "", collection_id: "", tenant_id: "", content: v.content,
        index: 0, start_offset: 0, end_offset: 0, token_count: 0, metadata: { ...v.metadata }, created_at: ZERO_TIME,
      },
      score,
      hydrated: false,
      orphaned: true,
    }
  }

  function maxTokensOf(value) {
    const n = intOf(value)
    if (n < 0) throw badRequest("max_tokens cannot be negative")
    return n === 0 ? 4096 : Math.min(n, 32768)
  }

  /** Skip-and-continue, as Weave's assembler does: a later, smaller hit can still fit. */
  function assemble(contents, maxTokens) {
    const included = []
    const parts = []
    let total = 0
    contents.forEach((content, i) => {
      if (content === null) return
      const tokens = Math.floor(bytes(content) / 4)
      if (total + tokens > maxTokens) return
      total += tokens
      included.push(i)
      parts.push(`[${included.length}] ${content}`)
    })
    let firstExcluded = -1
    for (let i = 0; i < contents.length; i += 1) {
      if (!included.includes(i)) {
        firstExcluded = i
        break
      }
    }
    return { context: parts.join("\n\n---\n\n"), total_tokens: total, max_tokens: maxTokens, included, first_excluded: firstExcluded, token_counter: "chars/4" }
  }

  function getCollection(input) {
    const id = parseId("col", "id", input?.id)
    const c = state.collections.get(id)
    if (!c) throw notFound("collection not found")
    return c
  }

  function getDocument(input) {
    const id = parseId("doc", "id", input?.id)
    const d = state.documents.get(id)
    if (!d) throw notFound("document not found")
    return d
  }

  function nameTaken(name, tenant, except) {
    return [...state.collections.values()].some((c) => c.id !== except && c.tenant_id === tenant && c.name === name)
  }

  function removeDocument(id) {
    state.documents.delete(id)
    for (const [cid, k] of state.chunks) {
      if (k.document_id === id) {
        state.chunks.delete(cid)
        state.vectors.delete(cid)
      }
    }
  }

  const COLLECTION_CHANGED = ["collections.list", "collections.get", "documents.list", "documents.get", "system.overview"]

  return {
    "system.overview": {
      kind: "query",
      handler: (input) => {
        const tenant = tenantOf(input)
        const docs = [...state.documents.values()].filter((d) => inTenant(d, tenant))
        return {
          collections: [...state.collections.values()].filter((c) => inTenant(c, tenant)).length,
          documents: docs.length,
          documents_by_state: countStates(docs),
          chunks: [...state.chunks.values()].filter((k) => inTenant(k, tenant)).length,
          stalled: docs.filter(isStalled).length,
          stalled_after_seconds: STALLED_AFTER_SECONDS,
          newest_documents: [...docs].sort(newest).slice(0, 10).map(documentRow),
          components: components(),
          scope: "all",
        }
      },
    },
    "system.components": {
      kind: "query",
      handler: () => ({
        components: components(),
        config: { ...config },
        extensions: [
          { name: "audit-trail", hooks: ["ingest_completed", "ingest_failed", "document_deleted"] },
          { name: "metrics", hooks: [] },
        ],
      }),
    },
    "collections.list": {
      kind: "query",
      handler: (input) => {
        const tenant = tenantOf(input)
        const search = typeof input?.search === "string" ? input.search.toLowerCase() : ""
        const rows = [...state.collections.values()]
          .filter((c) => inTenant(c, tenant) && (search === "" || c.name.toLowerCase().includes(search)))
          .sort(newest)
          .map(collectionRow)
        return list(rows, input)
      },
    },
    "collections.get": {
      kind: "query",
      handler: (input) => {
        const c = getCollection(input)
        const docs = [...state.documents.values()].filter((d) => d.collection_id === c.id)
        return { ...collectionRow(c), documents_by_state: countStates(docs), stalled: docs.filter(isStalled).length }
      },
    },
    "documents.list": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = page(input)
        const colId = optionalId("col", "collection_id", input?.collection_id)
        const st = typeof input?.state === "string" ? input.state : ""
        if (st !== "" && !STATES.includes(st)) throw badRequest("state must be pending, processing, ready or failed")
        const tenant = tenantOf(input)
        const search = typeof input?.search === "string" ? input.search.toLowerCase() : ""
        const rows = [...state.documents.values()]
          .filter((d) => (colId === "" || d.collection_id === colId) && (st === "" || d.state === st) && inTenant(d, tenant))
          .filter((d) => search === "" || (d.title ?? "").toLowerCase().includes(search))
          .sort(newest)
          .map(documentRow)
        return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }
      },
    },
    "documents.get": {
      kind: "query",
      handler: (input) => documentRow(getDocument(input)),
    },
    "documents.spans": {
      kind: "query",
      handler: (input) => {
        const d = getDocument(input)
        const spans = [...state.chunks.values()]
          .filter((k) => k.document_id === d.id)
          .sort((a, b) => a.index - b.index)
          .map((k) => ({ id: k.id, index: k.index, start_offset: k.start_offset, end_offset: k.end_offset, token_count: k.token_count }))
        return { document_id: d.id, content_length: d.content_length, spans: spans.slice(0, SPAN_CAP), total: spans.length, complete: spans.length <= SPAN_CAP }
      },
    },
    "chunks.list": {
      kind: "query",
      handler: (input) => {
        const { limit, offset } = page(input)
        const docId = optionalId("doc", "document_id", input?.document_id)
        const colId = optionalId("col", "collection_id", input?.collection_id)
        if (docId === "" && colId === "") throw badRequest("list chunks needs a document or a collection")
        const tenant = tenantOf(input)
        const rows = [...state.chunks.values()]
          .filter((k) => (docId === "" || k.document_id === docId) && (colId === "" || k.collection_id === colId) && inTenant(k, tenant))
          .sort((a, b) => (a.document_id === b.document_id ? a.index - b.index : a.document_id < b.document_id ? -1 : 1))
          .map((k) => ({ ...k, metadata: { ...k.metadata } }))
        return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset }
      },
    },
    "chunks.get": {
      kind: "query",
      handler: (input) => {
        const id = parseId("chk", "id", input?.id)
        const k = state.chunks.get(id)
        if (!k) throw notFound("chunk not found")
        const doc = state.documents.get(k.document_id)
        const sibling = (index) =>
          [...state.chunks.values()].find((x) => x.document_id === k.document_id && x.index === index)?.id ?? ""
        return { chunk: { ...k, metadata: { ...k.metadata } }, document_title: doc?.title ?? "", previous_id: sibling(k.index - 1), next_id: sibling(k.index + 1) }
      },
    },
    "collections.create": {
      kind: "command",
      invalidates: ["collections.list", "system.overview"],
      handler: (input) => {
        const name = typeof input?.name === "string" ? input.name.trim() : ""
        if (name === "") throw badRequest("name is required")
        const sizeIn = intOf(input?.chunk_size)
        const overlapIn = intOf(input?.chunk_overlap)
        if (sizeIn < 0 || overlapIn < 0) throw badRequest("chunk size and overlap cannot be negative")
        const size = sizeIn === 0 ? config.default_chunk_size : sizeIn
        const overlap = overlapIn === 0 ? config.default_chunk_overlap : overlapIn
        if (overlap >= size) {
          const from = (given) => (given === 0 ? " (the default)" : "")
          throw badRequest(`chunk overlap ${overlap}${from(overlapIn)} must be smaller than chunk size ${size}${from(sizeIn)}`)
        }
        if (nameTaken(name, "", "")) throw conflict("a collection with this name already exists")
        const id = idOf("col", serial++)
        const at = iso(Date.now())
        const c = {
          id, name,
          ...(typeof input?.description === "string" && input.description !== "" ? { description: input.description } : {}),
          tenant_id: "", app_id: "",
          embedding_model: config.default_embedding_model,
          embedding_dims: noEmbedder() ? 0 : 1536,
          chunk_strategy: config.default_chunk_strategy,
          chunk_size: size, chunk_overlap: overlap,
          metadata: { ...(input?.metadata ?? {}) },
          created_at: at, updated_at: at,
        }
        state.collections.set(id, c)
        return collectionRow(c)
      },
    },
    "collections.update": {
      kind: "command",
      invalidates: COLLECTION_CHANGED,
      handler: (input) => {
        const id = parseId("col", "id", input?.id)
        // The engine refuses a blank name before it reads the collection.
        const renamed = typeof input?.name === "string" ? input.name.trim() : null
        if (renamed === "") throw badRequest("collection name cannot be blank")
        const c = state.collections.get(id)
        if (!c) throw notFound("collection not found")
        if (renamed !== null) {
          if (nameTaken(renamed, c.tenant_id, c.id)) throw conflict("a collection with this name already exists")
          c.name = renamed
        }
        if (typeof input?.description === "string") {
          if (input.description === "") delete c.description
          else c.description = input.description
        }
        if (input?.metadata !== undefined && input?.metadata !== null) c.metadata = { ...input.metadata }
        c.updated_at = iso(Date.now())
        return collectionRow(c)
      },
    },
    "collections.reindex": {
      kind: "command",
      invalidates: ["collections.get", "system.overview"],
      handler: (input) => {
        const c = getCollection(input)
        if (noEmbedder()) throw unavailable("Weave has no embedder configured, so it cannot ingest or search")
        if (envOff("FIXTURE_WEAVE_REINDEX", "fail")) throw internal()
        const ready = [...state.documents.values()].filter((d) => d.collection_id === c.id && d.state === "ready")
        return { id: c.id, reindexed_documents: ready.length, elapsed_ms: 812.5 }
      },
    },
    "documents.ingest": {
      kind: "command",
      invalidates: ["documents.list", "chunks.list", "collections.list", "collections.get", "system.overview"],
      handler: (input) => {
        const colId = parseId("col", "collection_id", input?.collection_id)
        const content = typeof input?.content === "string" ? input.content : ""
        if (content.trim() === "") throw badRequest("content is empty")
        if (bytes(content) > MIB) throw badRequest("content is larger than 1 MiB; the dashboard ingests up to 1 MiB")
        const col = state.collections.get(colId)
        if (!col) throw notFound("collection not found")
        if (noEmbedder()) throw unavailable("Weave has no embedder configured, so it cannot ingest or search")
        const hash = sha256(content)
        if ([...state.documents.values()].some((d) => d.collection_id === colId && d.content_hash === hash)) throw conflict(DUPLICATE)
        const at = iso(Date.now())
        const id = idOf("doc", serial++)
        const doc = {
          id, collection_id: colId, tenant_id: col.tenant_id,
          ...(input?.title ? { title: String(input.title) } : {}),
          ...(input?.source ? { source: String(input.source) } : {}),
          ...(input?.source_type ? { source_type: String(input.source_type) } : {}),
          content_hash: hash, content_length: bytes(content), chunk_count: 0,
          metadata: { ...(input?.metadata ?? {}) },
          state: "processing", created_at: at, updated_at: at,
        }
        state.documents.set(id, doc)
        if (content.includes("FIXTURE_FAIL_EMBED")) {
          doc.state = "failed"
          doc.error = "embed: provider answered 503 Service Unavailable"
          return { document_id: id, state: "failed", chunk_count: 0, error: doc.error }
        }
        const pieces = chunkText(content.trim(), col.chunk_size || config.default_chunk_size, col.chunk_overlap)
        pieces.forEach((p, index) => {
          const cid = idOf("chk", serial++)
          const row = { id: cid, document_id: id, collection_id: colId, tenant_id: col.tenant_id, ...p, index, metadata: {}, created_at: at }
          state.chunks.set(cid, row)
          state.vectors.set(cid, vectorOf(row))
        })
        doc.state = "ready"
        doc.chunk_count = pieces.length
        return { document_id: id, state: "ready", chunk_count: pieces.length }
      },
    },
    "documents.delete": {
      kind: "command",
      invalidates: ["documents.list", "documents.get", "chunks.list", "collections.list", "collections.get", "system.overview"],
      handler: (input) => {
        const d = getDocument(input)
        removeDocument(d.id)
        return { id: d.id }
      },
    },
    "collections.delete": {
      kind: "command",
      invalidates: ["collections.list", "collections.get", "documents.list", "chunks.list", "system.overview"],
      handler: (input) => {
        const c = getCollection(input)
        for (const d of [...state.documents.values()]) if (d.collection_id === c.id) removeDocument(d.id)
        for (const [cid, k] of state.chunks) {
          if (k.collection_id === c.id) {
            state.chunks.delete(cid)
            state.vectors.delete(cid)
          }
        }
        state.collections.delete(c.id)
        return { id: c.id }
      },
    },
    "retrieval.run": {
      kind: "command",
      handler: (input) => {
        const query = typeof input?.query === "string" ? input.query : ""
        if (query.trim() === "") throw badRequest("query is empty")
        if (bytes(query) > 8192) throw badRequest("query is longer than 8 KiB")
        let topK = intOf(input?.top_k)
        if (topK < 0) throw badRequest("top_k cannot be negative")
        const maxTokens = maxTokensOf(input?.max_tokens)
        const colId = optionalId("col", "collection_id", input?.collection_id)
        if (noEmbedder()) throw unavailable("retrieval needs Weave's own embedder and vector store; this deployment has no embedder configured")
        const tenant = tenantOf(input)
        const minScore = typeof input?.min_score === "number" ? input.min_score : 0
        if (topK === 0) topK = config.default_top_k
        topK = Math.min(topK, 50)
        const window = Math.max(3 * topK, 50)

        const raw = [...state.vectors.values()]
          .filter((v) => (colId === "" || v.metadata.collection_id === colId) && (tenant === null || v.metadata.tenant_id === tenant))
          .map((v) => ({ v, score: similarity(query, v.content, v.id) }))
          .sort((a, b) => (b.score === a.score ? (a.v.id < b.v.id ? -1 : 1) : b.score - a.score))
          .slice(0, window)
        const rawRank = new Map(raw.map((r, i) => [r.v.id, i + 1]))

        let final
        if (noRetriever()) {
          final = raw.filter((r) => minScore <= 0 || r.score >= minScore).slice(0, topK)
        } else {
          const pool = raw.filter((r) => minScore <= 0 || r.score >= minScore)
          const perDoc = new Map()
          final = []
          while (final.length < topK && pool.length > 0) {
            let best = 0
            let bestValue = -Infinity
            pool.forEach((r, i) => {
              const value = r.score - 0.12 * (perDoc.get(r.v.metadata.document_id) ?? 0)
              if (value > bestValue) {
                bestValue = value
                best = i
              }
            })
            const [r] = pool.splice(best, 1)
            final.push(r)
            perDoc.set(r.v.metadata.document_id, (perDoc.get(r.v.metadata.document_id) ?? 0) + 1)
          }
        }

        let reordered = false
        let worst = 0
        const inFinal = new Set()
        const hits = final.map((r, i) => {
          const vectorRank = rawRank.get(r.v.id) ?? 0
          inFinal.add(vectorRank)
          worst = Math.max(worst, vectorRank)
          if (vectorRank !== i + 1) reordered = true
          return { ...hydrate(r.v, r.score), rank: i + 1, vector_rank: vectorRank, vector_score: r.score }
        })
        const leftOut = []
        raw.forEach((r, i) => {
          if (leftOut.length === topK || inFinal.has(i + 1) || i + 1 >= worst) return
          leftOut.push({ ...hydrate(r.v, r.score), rank: 0, vector_rank: i + 1, vector_score: r.score })
        })
        if (leftOut.length > 0) reordered = true

        return {
          result: {
            hits,
            left_out: leftOut,
            window,
            vector_matches: raw.length,
            best_vector_score: raw.length > 0 ? raw[0].score : 0,
            reordered,
            same_search: noRetriever(),
            score: noRetriever() ? "cosine" : "mmr_relevance",
            retriever_ms: noRetriever() ? 118.4 : 403.7,
            vector_ms: 118.4,
          },
          context: assemble(hits.map((h) => (h.chunk ? h.chunk.content : null)), maxTokens),
        }
      },
    },
    "retrieval.assemble": {
      kind: "command",
      handler: (input) => {
        const hits = Array.isArray(input?.hits) ? input.hits : []
        if (hits.length > 50) throw badRequest("at most 50 hits can be assembled at once")
        const contents = hits.map((h) => (typeof h?.content === "string" ? h.content : null))
        if (contents.reduce((n, c) => n + (c === null ? 0 : bytes(c)), 0) > MIB) throw badRequest("the hits hold more than 1 MiB of text in total")
        return assemble(contents, maxTokensOf(input?.max_tokens))
      },
    },
  }
}
