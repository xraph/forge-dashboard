# Weave dashboard: templ to React shell

Status: design approved in conversation on 2026-10-07, awaiting review of this
written spec.

Two repositories, both worked on `main` with no worktrees:

- Go: `/Users/rexraphael/Work/xraph/forgery/weave`, module
  `github.com/xraph/weave`. One module; the extension lives at `extension/`.
- React: this repo, as a new `packages/plugin-weave`.

Read `packages/plugin/PLAYBOOK.md` before touching either half. This spec
assumes you have.

## What this is for

Weave is a RAG pipeline engine. You load documents into collections, it chunks
and embeds them, and at question time a retriever ranks chunks and an
assembler turns them into the context a model reads. When a model gives a bad
answer, the first thing you want to know is what it was handed and why. The
templ dashboard can't tell you. Its retrieval page shows a score and some text
for each hit, and nothing else, because every retrieval path in the engine
throws away which chunk the hit was.

When this is done you can:

- run a query and see the ranking the configured retriever produced, next to
  the raw vector ranking, with each hit linked to its chunk and its document;
- see exactly which hits fit in the context and which fell off the end of the
  token budget, and read the assembled context itself;
- ingest text from the dashboard and watch what Weave made of it;
- see a document's chunks laid out as byte spans, with overlaps and gaps
  marked;
- trust the state badges, counts and dates, on every backend.

And the templ dashboard is gone from the extension.

## What the investigation found

Two read-only passes over the Go source on 2026-10-07, one over the domain and
one over `dashboard/`. The claims that decide the design were then checked by
hand against the code. The long form goes into `weave/MIGRATION.md`.

### Retrieval

- **Hits come back anonymous.** The similarity retriever (`retriever/similarity.go:60`),
  the MMR retriever (`retriever/mmr.go:114`) and the engine's own fallback
  (`engine/engine.go:571-584`) all build the result chunk from `Content` and
  `Metadata` only. Chunk ID, document ID, collection ID, index, offsets and
  token count are zero. The vector store does return the chunk ID
  (`vectorstore.SearchResult` embeds `Entry.ID`, which ingest sets to the chunk
  ID), and the engine drops it.
- **The `strategy` parameter does nothing.** `WithStrategy` sets
  `RetrieveParams.Strategy` (`engine/engine.go:480`) and nothing reads it. The
  engine runs whichever single retriever was passed to `WithRetriever`, or a
  plain vector search when none was.
- **Scores mean different things per retriever.** Memory and pgvector return
  cosine similarity. MMR reorders but returns the original relevance score, and
  ignores `MinScore`. Hybrid returns a reciprocal rank fusion sum (k=60), which
  is not comparable to cosine. The reranker overwrites the score and keeps no
  vector score. No concrete reranker ships.
- **The assembler is not wired to anything.** `assembler.New().Assemble` takes
  `[]retriever.Result` and returns the context string, citations, total tokens
  and a truncated count. Token counts are `len/4`. The engine and the HTTP API
  never call it.
- **Empty tenant searches everything.** Every vector store skips the tenant
  filter when `TenantKey` is empty.

### Ingestion

- Document `state` is `pending`, `processing`, `ready` or `failed`, and a
  failure stores its reason in `error`.
- Ingest is synchronous inside one request. `Start` is a no-op. There is no
  sweeper, lease or heartbeat, so a process that dies mid-ingest leaves the
  document in `processing` forever.
- A vector upsert failure marks the document failed but leaves its chunk rows.
- Duplicate content (same collection, same hash) is refused at
  `CreateDocument`. Only the memory store returns `ErrDuplicateDocument`; the
  other three pass the raw constraint error through.
- `Ingest` returns the document ID even when it fails. Weave's HTTP handler
  throws it away.

### Chunks and source text

- The source text is never stored. A document keeps `content_hash` (sha256)
  and `content_length` (bytes of the raw input).
- `start_offset` and `end_offset` are byte offsets into the text after the
  loader extracted it and after `strings.TrimSpace`. The semantic and code
  chunkers approximate them. The recursive chunker falls back to 0 when it
  can't find the text. Fixed and sliding windows can split a UTF-8 rune.
- `token_count` is `len/4` in every chunker.
- Embeddings never sit on a chunk. They live only in the vector store.

### Collections

- `embedding_model`, `embedding_dims` and `chunk_strategy` are recorded and
  never used: the engine has one global embedder and one global chunker. Only
  `chunk_size` and `chunk_overlap` take effect.
- No engine method or route updates a collection.
- `document_count` and `chunk_count` on the collection row are never updated,
  so they read 0. `CollectionStats` counts live.
- Reindex exists (`engine/engine.go:649-727`). It deletes every vector in the
  collection first, then re-embeds the existing chunks of `ready` documents with
  the global embedder. It never re-chunks, runs synchronously, and a failure
  partway leaves the collection partly indexed with no failure event.

### Stores

- Postgres, SQLite and Mongo drop `created_at` and `updated_at` when reading
  collections and documents back, so both read as zero time. Memory is fine.
- Postgres hard-codes `$1`, `$2`, `$3` in `ListDocuments`, `CountDocuments` and
  `CountChunks`. grove only rewrites `?`, so any filter that skips an earlier
  argument breaks. On Postgres every state count is 0.
- Every list sorts `created_at ASC`, so every "recent" list in templ shows the
  oldest rows.
- `CountFilter` for documents has no search field, so a searched list reports
  the unsearched total.
- Paging is offset and limit everywhere. Chunks by document are unpaginated,
  and there is no chunks-by-collection listing.

### Tenancy

Nothing in production calls `weave.WithTenant` or `weave.WithApp`. No store
query filters on tenant. Rows are written with whatever tenant the context
carries, which on every path we found is `""`. A library user can set one
through the exported helpers, so tenants may exist in someone's data, but the
dashboard path never resolves one.

### Configuration and components

- The extension never passes its config to the engine (no `WithConfig`), so
  YAML defaults such as `default_chunk_size` never arrive.
- There is no way to ask the engine which loader, chunker, embedder, vector
  store or retriever it runs.
- Plugins expose `Name()` only. Which hooks each implements is discoverable by
  type assertion.

### Tests

Weave has 517 lines of tests, covering `id/` and `vectorstore/fabriq/`. There
are none on the engine, the four stores, the retrievers or the assembler.

### What the 12 templ pages show

The full inventory goes into `MIGRATION.md`. The parts that matter for design:
create, edit and delete call routes that don't exist (`/weave/collections`
instead of `/weave/v1/collections`, a PUT nobody serves, form encoding against
JSON handlers); the delete dialog's success handler throws; errors are
swallowed everywhere, so a missing embedder shows "No results"; the Pipeline
page and widget report every stage Active unconditionally; the Loaders page is
a hard-coded list that disagrees with the real `Supports()` methods.

## Decisions

Made in conversation on 2026-10-07.

1. **Fix Weave, then show it.** The engine gets the honesty fixes the pages
   need, plus new capabilities, each with tests. Behaviour lives in the engine
   and the contract stays thin (approach A). Reaching into `engine.Store()` from
   the contract is how the templ dashboard hid its bugs, so we don't.
2. **Operator-wide, with an optional tenant filter.** The dashboard sees every
   tenant. Lists and retrieval take an optional tenant. Absent means every
   tenant; present is an exact match, `""` included.
3. **Ingest from the dashboard** by pasting text or picking a text file the
   browser reads, capped at 1 MiB on the server.
4. **Retrieval shows the configured ranking and the raw vector ranking side by
   side**, with the assembled context from the default assembler.
5. **All work on `main`** in both repos. Engine work starts now. Anything that
   needs `xraph/weave#39` (the unwiring of the templ contributor) waits for it to
   merge.
6. **Wire field names are snake_case**, copied from Weave's JSON tags. Request
   types follow the same convention so each intent reads consistently.

## The Go half

### Engine and store fixes

Each one ships with tests (see Testing).

1. **Hits keep their identity.** The similarity and MMR retrievers and the
   engine fallback set `Chunk.ID` from the vector entry ID. The engine then
   hydrates each hit from the chunk store. A vector whose chunk row is missing
   is kept at its rank and marked orphaned, never dropped.
2. **Timestamps survive the read** in the Postgres, SQLite and Mongo
   `*FromModel` functions.
3. **Postgres placeholders** become `?` bindings in `ListDocuments`,
   `CountDocuments` and `CountChunks`.
4. **Newest first, on request.** Collection and document list filters gain
   `SortDesc`. The default order stays ascending, so API clients paging by
   offset don't shift.
5. **Duplicates are typed.** All four backends return `ErrDuplicateDocument`
   for a repeated content hash.
6. **Searched and stalled counts.** The document `CountFilter` gains `Search`,
   applied the same way as the list, and `UpdatedBefore`, which the Overview's
   stalled count uses (state `processing`, not updated for 15 minutes).
7. **The extension passes its config to the engine** with `WithConfig`. This
   touches `extension/extension.go`, so it lands with the contract, after #39.

### New engine capabilities

8. **Tenant filter.** Collection and document list and count filters, the chunk
   listing and retrieval take `Tenant *string`. Nil means no filter. A non-nil
   value is an exact match, including `""`. Retrieval sends it as a metadata
   filter, because every vector store ignores an empty `TenantKey`. Fabriq's
   filter semantics can't be checked locally, so the component report marks
   tenant filtering on Fabriq as unverified.
9. **`UpdateCollection`** changes name, description and metadata only, through
   pointer fields. The chunk settings and the recorded model, dims and strategy
   are fixed at creation, because nothing can re-chunk existing documents.
10. **`Components()`** reports the wired loader, chunker, embedder (with
    dimensions), vector store and retriever, each with its kind and parameters
    (MMR lambda, hybrid k, reranker present). It works by type switch; an
    unknown type reports its Go type name. Each retriever kind also names what
    its score means: cosine, cosine with MMR order, RRF sum, rerank score.
11. **`RetrieveCompare`** runs the configured retriever and a raw vector search
    over a wider window, `max(3 × top_k, 50)`. It returns the final ranking with
    each hit's raw cosine score and raw rank, the vector matches the retriever
    left out, and the elapsed time of each side. With no retriever configured
    both sides are the same search, and the result says so.
12. **`Assemble`** runs the default assembler over a ranking with a token
    budget you choose.
13. **`ListChunks`** pages chunks by document or by collection, on all four
    backends.
14. **`DescribeExtensions`** lists each extension's name and the lifecycle hooks
    it implements.

### Not changed, shown honestly

The ignored `strategy` parameter, recorded-but-unused model, dims and strategy,
re-embed-only reindex, no re-chunk, no stored source text, `processing` with no
heartbeat, and the missing `weave_vectors` migration. Each is said on the page
where it matters and recorded in `MIGRATION.md`.

### The extension

After #39 merges: move to forge v1.12.0 and grove v1.7.0, add
`RegisterContractContributor` the way Trove does
(`trove/extension/dashboard_contract.go`), and put the
`dashboard.ContractContributorAware` assertion in a `_test.go` file. Production
code never imports forge's root `extensions/dashboard` package, because its
`auth` subpackage still pulls in templ.

### The contract package

`extension/contract/`, shaped like Trove's: an embedded `manifest.yaml`,
`Register` that loads and validates it and refuses a handler the manifest
doesn't declare, and one file of handlers per area. The contributor is `weave`
with capabilities `weave.read` and `weave.write`. The manifest says in a comment
that the dashboard is operator-wide.

Every list takes `limit` and `offset` and answers `items` and `total`. Every
list takes an optional `tenant`.

| intent | kind | answers / invalidates |
|---|---|---|
| `system.overview` | query | counts (collections, documents by state, chunks), the 10 newest documents, the stalled count, a components summary |
| `system.components` | query | `Components()`, the engine config as the engine holds it, extensions with their hooks |
| `collections.list` | query | collections with live document and chunk counts per row; name search |
| `collections.get` | query | a collection with its stats |
| `documents.list` | query | filter by collection, state, title search |
| `documents.get` | query | a document with its collection's name |
| `documents.spans` | query | every chunk's `id`, `index`, `start_offset`, `end_offset`, `token_count` for one document, capped, with `complete: false` past the cap |
| `chunks.list` | query | chunks by document or by collection, paged |
| `chunks.get` | query | a chunk with the IDs of its neighbours |
| `collections.create` | command | invalidates `collections.list`, `system.overview` |
| `collections.update` | command | invalidates `collections.list`, `collections.get`, `documents.list`, `documents.get`, `system.overview` |
| `collections.delete` | command | invalidates `collections.list`, `collections.get`, `documents.list`, `chunks.list`, `system.overview` |
| `collections.reindex` | command | invalidates `collections.get`, `system.overview`; answers how many documents it re-embedded |
| `documents.ingest` | command | invalidates `documents.list`, `chunks.list`, `collections.list`, `collections.get`, `system.overview`; answers `document_id`, `state`, `error` |
| `documents.delete` | command | invalidates `documents.list`, `documents.get`, `chunks.list`, `collections.list`, `collections.get`, `system.overview` |
| `retrieval.run` | command | invalidates nothing; answers the `RetrieveCompare` result and the assembled context |
| `retrieval.assemble` | command | invalidates nothing; re-assembles from `chunk_id` and `score` pairs with a new budget, without embedding again |

`retrieval.run` is a command on purpose. Every run calls the embedder, which is
usually a paid API call, and a query can be cached and refetched when the
window regains focus. A command fires only when you press Run.

No response type has a vector field. A Go test marshals every handler's
response and fails if `vector` or `embedding` appears anywhere in it.

Errors map to typed codes: not found, invalid argument (the 1 MiB cap, overlap
at or above size, an unparseable ID), conflict (duplicate document, duplicate
collection name). Anything else is internal and logged. Nothing is swallowed.

## The React half

`packages/plugin-weave`, with `extension: "weave"`, `namespace: "weave"` and
`label: "Weave"`. Every nav item sits in the group "RAG".

### Information architecture

| route | page |
|---|---|
| `/` | Overview |
| `/retrieval` | Retrieval |
| `/collections` | Collections |
| `/collections/new` | Create collection |
| `/collections/:id` | Collection detail |
| `/collections/:id/edit` | Edit collection |
| `/collections/:id/ingest` | Ingest |
| `/documents` | Documents |
| `/documents/:id` | Document detail |
| `/chunks` | Chunks |
| `/chunks/:id` | Chunk detail |
| `/pipeline` | Pipeline |

Nav order: Overview, Retrieval, Collections, Documents, Chunks, Pipeline. The
templ Loaders, Extensions and Settings pages fold into Pipeline.

Every collection, document and chunk ID carries `font-mono text-xs`. All five
display conventions apply everywhere.

### Overview

A `StatGrid` of collections, chunks, and documents by state, plus the stalled
count. A newest-documents table, newest first for real. A components strip
linking to Pipeline. One line says this dashboard sees every tenant's data.

### Collections

`ResourceTable` columns: name in `font-medium` with its description, ID,
tenant, live document and chunk counts, chunk size and overlap, created date.
Name search, a tenant filter, offset paging.

### Collection form

Create takes name, description, chunk size, chunk overlap (rejected at or
above size) and metadata. Model, dims and strategy sit in a box titled
"Recorded, not used", which shows what this deployment actually runs, from
`Components()`.

Edit changes name, description and metadata. The chunk settings show read-only
with: "Fixed at creation. Weave can't re-chunk existing documents, so a change
would only apply to new ones. Reindex re-embeds the existing chunks with the
current embedder; it doesn't re-chunk."

### Collection detail

Stats by state, a `DescriptionList` (ID, tenant, app, timestamps, chunk
settings), metadata sorted by key, the newest documents. Actions: Ingest,
Reindex, Edit, Delete.

The Reindex confirmation says what it does: it deletes every vector in the
collection first, re-embeds `ready` documents only, runs synchronously, and
leaves the collection partly indexed if it fails partway.

### Ingest

Paste text, or pick a `.txt`, `.md`, `.html`, `.csv` or `.json` file that the
browser reads as text; `source_type` follows the file. Title, source and
metadata. The result shows inline: ready with N chunks, failed with the stored
error, or already ingested for a duplicate.

### Documents

Filters: collection, state, title search, tenant. Columns: title, ID,
collection link, state, chunks, size, updated.

### Document detail

Details including the full content hash with a copy button. A failed document
shows its stored error in an alert.

The span map draws chunks as byte ranges along a bar scaled to the largest
`end_offset` (see `documents.spans` in the slice 3 hand-off: `content_length`
is the raw input and can be on a different scale), shades overlap with the
previous chunk, and flags gaps as bytes no chunk covers. Its caption says the offsets are byte offsets into the text after
loading and trimming, and that two chunkers approximate them. Below it, the
chunk reader shows every chunk's full text in order with overlap highlighted,
in a lazily loaded virtualised list.

### Chunks and chunk detail

The Chunks page opens on a collection picker and then pages that collection's
chunks. Chunk detail shows full text, offsets, token estimate, metadata, and
previous and next links.

### Pipeline

The component report: each stage with its kind, parameters and what its score
means. The engine config. Supported content types per loader, from the real
`Supports()`. Extensions with the hooks each implements.

### Retrieval

The page someone opens when an answer was bad.

```
┌ Ask Weave ──────────────────────────────────────────────────────────────┐
│ [ query ............................................................ ] │
│ Collection [All]  Tenant [All]  Top K [10]  Min score [0]  [Run query]  │
├─────────────────────────────────────────────────────────────────────────┤
│ MMR retriever (λ 0.7). Scores are cosine relevance, order is MMR.       │
│ 10 hits in 412 ms. Vector search scanned 50 in 120 ms.                  │
├─[ Ranking ]─[ Context sent to the model ]─[ Left out ]──────────────────┤
│  #  Cosine  Vector rank  Chunk                        Source  │ inspector│
│  1  0.831   1            "Refunds are issued within…" doc #3  │          │
│  2  0.802   7  ↑5        "If the order shipped…"      doc #12 │          │
│ ── context budget 4,096 tokens: 6 chunks, 3,980 used ──────── │          │
│  7  0.744   4  ↓3        (dimmed)                             │          │
└───────────────────────────────────────────────────────────────┴──────────┘
```

- **Ranking.** A `ResourceTable` row per hit: rank, final score under a header
  named for its kind (Cosine, RRF score, Rerank score), raw vector rank with
  movement, the chunk text clamped to two lines, and the source document and
  chunk index. Scores use `tabular-nums` and three decimals. No score colours
  and no 0 to 1 bars: a cosine value means different things on different
  embedding models, and a colour would claim a quality judgement nobody can
  make. The budget line is a full-width row; rows under it are dimmed and say
  they were retrieved but over budget. Selecting a row fills an inspector with
  the full text, links to the chunk and document, offsets, tokens and sorted
  metadata. On narrow screens the inspector is a sheet. An orphaned hit keeps
  its rank with a destructive "no chunk row" badge.
- **Context sent to the model.** The assembled text exactly as built, read-only
  and pre-wrapped, each `[n]` marker linking back to its row. The budget is
  editable and Re-assemble calls `retrieval.assemble`. Above it: "Built by
  Weave's default assembler (token counts are estimates: characters ÷ 4). Your
  app may assemble its own way."
- **Left out.** Strong vector matches inside the scanned window that the
  configured retriever didn't return. With no reordering retriever: "No
  reordering: this deployment returns the vector ranking as-is."
- **Three kinds of empty.** Nothing run yet: an invitation to ask. Vector search
  found nothing: the collection has no vectors, or the tenant filter excludes
  everything. Vector search found N and the retriever returned none: for
  example "min score 0.8 removed all 23 vector matches; the best was 0.71".
- Errors such as a missing embedder show in a `CommandAlert` with the server's
  message.
- Run, and Enter, are disabled while a run is in flight. The last result stays
  on screen while the next loads.
- A query never goes into the URL. It can hold customer text, and URLs land in
  tracing.

### Badges

Document state, proportion first:

| state | variant | why |
|---|---|---|
| `ready` | outline | the majority in any healthy collection |
| `pending` | secondary | transient |
| `processing` | default | worth a second look |
| `failed` | destructive | what you came to find |

A `processing` document whose `updated_at` is more than 15 minutes old also
carries a destructive marker, "no update for 3 h", with the real age. Ingest
runs inside one request, so a document still processing after that long almost
certainly died with its process. Weave has no heartbeat, so the copy states the
age and doesn't call it dead.

### Lazy loading

The chunk reader's virtualiser (`@tanstack/react-virtual`, already in kit) loads
with the document detail route, lazily. A lazy-chunks test checks it stays out
of the entry chunk, and `BASELINE.md` is re-measured. The context viewer is
plain pre-wrapped text, since the assembled context is prose and CodeMirror
isn't worth its weight here.

### Wiring

`apps/shell` and `apps/example-next` import the plugin the way they import
Trove, and the shell's stylesheet scans the package.

### Dropped

Recorded in `MIGRATION.md` with these reasons:

- The three widgets. Overview covers them, and plugins have no widget slot.
- The settings panel. It was a read-only copy of the Pipeline config.
- The five templ plugin hooks in `plugin_iface.go`. Nothing implements them and
  each returns `templ.Component`.
- The "searchable" capability. It was declared and never implemented.

## Fixtures

`packages/fixture-server/weave-fixtures.mjs`, registered in `server.mjs`. That
file holds other sessions' uncommitted work, so it is changed with the Edit
tool only and our hunk is committed through a temporary index.

The fixture models the fixed contract, not today's engine: hydrated hits, a
comparison where MMR moved hits, one orphaned hit, a failed document with its
error, a stalled `processing` document, a refused duplicate and a budget
cut-off. Writes change the next read, so an ingest grows the list and a delete
shrinks it. Every intent gets walked over HTTP.

## Sequencing

| slice | repo | waits for | contents |
|---|---|---|---|
| 1 | weave | nothing | engine and store fixes 1 to 6 and capabilities 8 to 14, test first |
| 2 | forge-dashboard | nothing | `packages/plugin-weave`, `weave-fixtures.mjs`, shell wiring |
| 3 | weave | #39 merged | forge v1.12.0, grove v1.7.0, `extension/contract`, registration, `WithConfig` |
| 4 | both | 2 and 3 | click through every page in a browser |
| 5 | weave | 4 | `MIGRATION.md`, then the templ deletion as its own commit |

Nothing is pushed without asking.

## Retiring the templ dashboard

Following the playbook, in order. Write the inventory into `MIGRATION.md` while
the pages exist and account for every page, column, action, filter, badge,
empty state, widget and nav item as migrated, changed or dropped with a reason.
Grep for importers of `github.com/xraph/weave/dashboard`. Then, as its own
commit, delete `dashboard/` with its 27 generated `*_templ.go` files, drop
`github.com/a-h/templ` and `github.com/xraph/forgeui` and run `go mod tidy`.
Prove it: `find . -name '*.templ' -not -path './_*'` returns nothing, and
`go build ./... && go test ./...` pass.

## Testing

### Go

- A deterministic fake embedder hashes text into a small vector, so retrieval
  tests need no network. It lives in test helpers only.
- Every store change runs on memory, SQLite, Postgres and Mongo. Postgres and
  Mongo run in throwaway containers on odd ports, never 5432 or 27017.
- Tenant tests write rows under two tenants and under `""`, and assert on
  identity, never on counts. One test per backend pins what an empty tenant
  does, as a recorded fact.
- Conformance tests populate the fields the new paths write: metadata, offsets,
  timestamps. A suite that only builds empty structs tests the absence of the
  feature.
- Contract tests cover each handler's mapping, the manifest against the
  bindings, and the no-vectors rule.
- Lint with a fresh cache every run.

### React

- Every page has vitest coverage, including all three kinds of empty and an
  error raised inside each dialog.
- Every `ConfirmDialog` sets `pending`. Failure tests throw `ContractError`, so
  none passes by resolving `{ ok: false }`.
- A plugin test walks every fixture response for `vector` and `embedding` keys.
- `test`, `typecheck` and `lint` clean in the package, and `pnpm -r test`.

### What this coverage won't prove

Loaders, chunker internals, the MMR, hybrid and reranker maths, and Fabriq stay
untested by this work. `MIGRATION.md` says so in plain words.

## What slice 1 found that slice 2 must know

Slice 1 is done: the Go engine and store half is on weave `main`, and all four backends (memory, SQLite, Postgres, Mongo) pass the same conformance suite with no skips. This section is for whoever writes the React plugin. Read the shapes first, then the behaviours, because a few of them are not what the plan said.

### The wire shapes, copied from the code

These are the Go structs as they stand, tags included. Field names on the wire are exactly the json tags.

```go
// engine/engine.go
type ScoredChunk struct {
	Chunk *chunk.Chunk `json:"chunk"`
	Score float64      `json:"score"`
	// Hydrated is true when Chunk was read back from the metadata store by
	// ID, so every field on it is real.
	Hydrated bool `json:"hydrated"`
	// Orphaned is true when the vector store returned a chunk ID that has no
	// row in the metadata store. The hit keeps its rank and its text.
	Orphaned bool `json:"orphaned,omitempty"`
}

// engine/compare.go
type CompareHit struct {
	ScoredChunk
	Rank        int     `json:"rank"`
	VectorRank  int     `json:"vector_rank"`
	VectorScore float64 `json:"vector_score"`
}

type CompareResult struct {
	Hits            []CompareHit    `json:"hits"`
	LeftOut         []CompareHit    `json:"left_out"`
	Window          int             `json:"window"`
	VectorMatches   int             `json:"vector_matches"`
	BestVectorScore float64         `json:"best_vector_score"`
	Reordered       bool            `json:"reordered"`
	SameSearch      bool            `json:"same_search"`
	Score           weave.ScoreKind `json:"score"`
	RetrieverMillis float64         `json:"retriever_ms"`
	VectorMillis    float64         `json:"vector_ms"`
}

// engine/assemble.go
type AssembledContext struct {
	Context       string `json:"context"`
	TotalTokens   int    `json:"total_tokens"`
	MaxTokens     int    `json:"max_tokens"`
	Included      []int  `json:"included"`
	FirstExcluded int    `json:"first_excluded"`
	TokenCounter  string `json:"token_counter"`
}

type ChunkRef struct {
	ChunkID id.ChunkID `json:"chunk_id"`
	Score   float64    `json:"score"`
}

// engine/components.go
type Component struct {
	weave.ComponentInfo
	Type         string   `json:"type,omitempty"`
	Configured   bool     `json:"configured"`
	ContentTypes []string `json:"content_types,omitempty"`
	Dimensions   int      `json:"dimensions,omitempty"`
}

type Components struct {
	Loader       Component       `json:"loader"`
	Chunker      Component       `json:"chunker"`
	Embedder     Component       `json:"embedder"`
	VectorStore  Component       `json:"vector_store"`
	Retriever    Component       `json:"retriever"`
	Score        weave.ScoreKind `json:"score"`
	TenantFilter string          `json:"tenant_filter"`
}

// component.go (package weave)
type ComponentInfo struct {
	Kind         string            `json:"kind"`
	Params       map[string]string `json:"params,omitempty"`
	Score        ScoreKind         `json:"score,omitempty"`
	TenantFilter string            `json:"tenant_filter,omitempty"`
	Children     []ComponentInfo   `json:"children,omitempty"`
}

type ScoreKind string

const (
	ScoreCosine           ScoreKind = "cosine"
	ScoreVectorSimilarity ScoreKind = "vector_similarity"
	ScoreMMR              ScoreKind = "mmr_relevance"
	ScoreRRF              ScoreKind = "rrf"
	ScoreRerank           ScoreKind = "rerank"
	ScoreUnknown          ScoreKind = "unknown"
)

// engine/extensions.go
type ExtensionInfo struct {
	Name  string   `json:"name"`
	Hooks []string `json:"hooks"`
}
```

Two things about those shapes trip people up. `CompareHit` embeds `ScoredChunk` with no tag, so on the wire a hit is one flat object: `chunk`, `score`, `hydrated`, `orphaned`, `rank`, `vector_rank`, `vector_score`. And `Component` embeds `ComponentInfo` the same way, so `kind`, `params`, `score`, `tenant_filter` and `children` sit beside `type` and `configured`. Neither wraps anything under a key of its own.

`ScoredChunk.chunk` is the full `chunk.Chunk`, which has no vector field. The no-vectors rule holds without any stripping.

`ChunkRef` is the input of `AssembleRefs`, which `retrieval.assemble` calls to re-assemble a ranking you already have, by chunk ID, without embedding anything.

`hits`, `left_out` and the chunk list from `ListChunks` are always arrays. An empty one is `[]` on the wire, never `null`, so you don't need a null guard for any of them.

### Behaviours that differ from the plan

Reordered and LeftOut are per query, whatever the retriever kind. The plan said `Reordered` is true for every non-similarity retriever. The controller ruled otherwise and the spec wins: `LeftOut` is the raw-window hits that are not in the final list and whose vector rank is better than the worst vector rank among the final hits (any rank counts if a final hit has vector rank 0), in vector order, capped at `TopK`. `Reordered` is true when some hit's `rank` differs from its `vector_rank`, or when `left_out` is not empty. An MMR retriever that happens to return raw order for one query reports `reordered: false`. `same_search` is true when no retriever is configured, because both sides then come from one vector search and cannot disagree.

So the "No reordering" copy depends on why nothing moved. If `same_search` is true, or `components.retriever.kind` is `"similarity"`, you can say it about the deployment: this deployment returns the vector ranking as-is. If `reordered` is false under MMR, hybrid or rerank, say it about the query only: this query came back in vector order. The next query may not. Either way the page names the retriever kind from `system.components`, never from the compare result.

`vector_rank` is 1-based. A 0 means the hit has no place in the raw window, either because it sat outside it or because it had no chunk ID to look up. A `left_out` hit always has `rank` 0, since it isn't in the final list, and its `score` is the raw vector score (cosine on the memory store and on pgvector), not whatever the retriever scores in. `compare_result.score` describes `hits` only. Label the left-out scores on the page as vector scores.

Score ties no longer fake a move. `RetrieveCompare` runs two separate searches, and the memory store used to sort tied scores in map order, so a similarity retriever over tied chunks showed `reordered: true` and a non-empty `left_out` about a third of the time. The memory store and pgvector now break score ties by ID, so both searches agree. Fabriq's tie order is unknown.

A hit has three possible states, and the page has to draw all three. Hydrated is the normal one. Orphaned means the vector store returned a chunk ID with no row in the metadata store (`hydrated` false, `orphaned` true). Unidentified means `hydrated` false and `orphaned` false: a custom retriever set no chunk ID, or returned a nil chunk, so `chunk` can be `null`. Both odd cases keep their rank. Don't drop them from the table.

A hydrated hit keeps the vector store's metadata keys (`collection_id`, `document_id`, `tenant_id`, `chunk_index`) in `chunk.metadata`, with the row's own keys winning a clash. An orphan carries the same keys, because the vector store is all it has, so the two shapes match and you can read an orphan's document from `chunk.metadata.document_id`. Each hit is a copy of the stored row, and editing it never edits the store.

Assembly skips a hit that does not fit and carries on, so a later, smaller hit can still get in. That means `included` is not a prefix. The page dims each row from `included`, and the budget line sits above the row at `first_excluded`. `first_excluded` also covers a hit with no chunk, not only a budget overrun, and it is `-1` when everything made it in. Marker `[n]` in `context` is hit `included[n-1]`. The token count is `chars/4`, and `token_counter` says so.

`RetrieveCompare` emits no retrieval hooks. It also needs the engine's own embedder and vector store, so a retriever-only engine is refused. Don't wire the compare panel to anything that counts retrievals.

Tenant filter semantics are pinned on all four store backends. On retrieval they're tested on the memory vector store only. pgvector's "verified" label rests on reading its code, because no pgvector test runs, and rows ingested through the `pipeline` package carry no `tenant_id` key at all (see the MIGRATION findings below). A nil tenant means every tenant. A pointer to `""` means only untenanted rows. The contract has to keep that difference: an absent `tenant` query parameter is not the same request as `tenant=`.

Store additions, all covered by the conformance suite on every backend:

- List filters for collections and documents have `SortDesc`, newest first with ties broken by id. The default stays ascending.
- Document counts take `Search` and `UpdatedBefore`, so the list and its count agree.
- Chunk listing pages by document or by collection, ordered by document, then chunk index.
- SQL search treats `%`, `_` and `\` as literal characters. Before this, a search for `50%` was a wildcard on SQLite and Postgres.
- A duplicate document (same content) and a duplicate collection name (on create or on rename) return `weave.ErrDuplicateDocument` and `weave.ErrCollectionAlreadyExists` on every backend. The contract should map both to a conflict, not a 500.
- SQLite pages by offset without a limit.

The contract must refuse a negative `limit` or `offset` as an invalid argument before it reaches a store. The memory store panics on a negative chunk offset, and the SQL backends hand back a raw driver error.

### Findings for MIGRATION.md

Two items that slices 2 and 3 should carry into the migration notes.

`pipeline/steps.go` leaves `tenant_id` out of the vector metadata for untenanted rows. The engine does not read that key for those rows today, so nothing breaks, but anything that filters vector metadata on `tenant_id = ""` would find nothing.

Weave's own HTTP retrieve route now returns hydrated hits, with chunk IDs present, because `Retrieve` reads each hit back by ID. Existing clients keep working. `chunk.metadata` still carries `collection_id`, `document_id`, `tenant_id` and `chunk_index`, and the hit gains the real top-level fields (`document_id`, `collection_id`, `tenant_id`, `index`, offsets and token count) beside them. That costs one `GetChunk` per hit, which is fine at `TopK` scale and worth a batch getter if `TopK` grows.

### What the plan did not predict

- All three database backends dropped `created_at` and `updated_at` on read. The mappers never copied them across, so every collection and document came back with a zero time. Fixed first (`e22df42`), because the new sort and the stalled-document cutoff both depend on it.
- Postgres document filters did not work at all. Every list and count with a filter failed with `could not determine data type of parameter $1 (SQLSTATE 42P18)`, because the clauses used literal `$N` placeholders. Mongo's search compiled the user's text as a regular expression, so `(` was an error.
- SQLite cannot take `OFFSET` without `LIMIT`, and the grove driver silently drops a negative limit. The store now sends `math.MaxInt32` as the limit when a caller gives an offset and no limit.
- `go mod tidy` is not clean on `main`, and was not before this slice. It wants to drop about 25 unrelated indirect requirements. Slice 1 only moved `github.com/jackc/pgx/v5` to the direct block by hand and left the rest. Someone should decide on a whole-module tidy separately.
- A freshly started Mongo container accepts TCP before `mongod` is ready, so the first conformance run against a two-minute-old container timed out on server selection. A re-run seconds later was fine. If you see that in CI, wait before you retry.
- Postgres ingest with no metadata map was broken before this slice. The mappers passed a nil map into the `metadata NOT NULL` jsonb columns, so the write failed on the not-null constraint. Mongo refused the same writes against its schema, which wants an object. Both now store an empty map, and a `NilMetadata` conformance case writes a collection, a document and a chunk with nil metadata on all four backends.
- The default `golangci-lint` run holds a lock, and four tasks could not lint at all. The findings they carried (one `unnamedResult`, two `shadow`, two `prealloc`) are cleared in the last commit below, and the fresh-cache run now reports `0 issues`.

### Commits

Weave `main`, in the order they landed. Task numbers are the plan's.

| Task | Commit |
| --- | --- |
| 1 | `e22df42`, `973f5b4` |
| 2 | `6eb3640`, `f422820` |
| 3 | `d3e58a3` |
| 4 | `05a4946` |
| 5 | `9f53ef9`, `69642e5` |
| 6 | `685d6a5`, `8cd67ac` |
| 7 | `4cd3339` |
| 8 | `06f5f67` |
| 9 | `2ed6e0b` |
| 10 | `cb83e3e` |
| 11 | `d0542c1`, `14ec06d` |
| 12 | `bfe9f79`, `2eedaf0` |
| 13 | `2a1f10c` |
| 14 | `5621a2c` |
| Review fixes | `9a0838c`, `c9a8de0`, `6eac0f4`, `bd5bae3`, `0d29d1b` |

Task 1 also carries `973f5b4`, the test helpers that refuse ports 5432 and 27017 however the DSN spells them. Task 14 is the lint clean-up, `chore: clear the lint the slice left behind`. The review fixes came out of the final whole-slice review: score ties broken by ID (`9a0838c`), vector metadata kept on hydrated hits that no longer share the store's chunk (`c9a8de0`), empty lists answered as arrays (`6eac0f4`), nil metadata stored as empty on Postgres and Mongo (`bd5bae3`), and a lint fix in the orphan test (`0d29d1b`). Nothing is pushed.

## What slice 3 found that slice 2 must know

Slice 3 is done: the Weave contract is on weave `main` and answers all 17 intents in the manifest from the engine. This section is the wire, for whoever writes `packages/plugin-weave`. Every struct below was pulled out of `extension/contract/*.go` by script, so the field names are the Go tags and nothing was retyped. Where this section and an earlier one in this spec disagree, this one wins. The last part lists the places where that happens.

### What changed around the contract

Templ is gone from Weave, and it went in this slice. The slice table puts the deletion in slice 5; it didn't wait. `MIGRATION.md` landed at `4772ecc` (with a fix at `79ca320`), `dashboard/` was deleted at `9221db3`, and forge v1.12.0 and grove v1.7.0 arrived with the tidy at `d691ab5`. Slice 5 now only confirms the "moved" entries in `MIGRATION.md` once the browser walk is done. `find . -name '*.templ' -not -path './_*'` is empty, and `a-h/templ` and `xraph/forgeui` appear nowhere in `go.mod`, `go.sum` or any build or test graph.

One thing in `go.mod` will look odd. The tidy removed the otel exporters, grpc and genproto, and `extension/dashboard_contract_test.go` put them back as indirect requirements. That file's assertion that the extension satisfies `ContractContributorAware` imports forge's dashboard root package, and that package needs them. Production code never imports the root package, only `contract`, `contract/dispatcher` and `contract/loader`. One internal change has no wire effect: the helper `optionalCollectionID` lost its field-name argument.

The contributor name, the extension name and your plugin's `extension` field are all `weave`. A mismatch hides the plugin with no error anywhere. The manifest asks for the capabilities `weave.read` (every query) and `weave.write` (every command, `retrieval.run` and `retrieval.assemble` included).

The YAML config (default chunk size and overlap, embedding model, strategy, default top_k, shutdown timeout) now reaches the engine. Before this slice it never did, so every deployment ran on the built-in defaults whatever the file said. `system.components` reports the values the engine actually holds, and the collection form's defaults should come from there. The extension also refuses to start when the effective default overlap is at or above the effective default chunk size, so `config.default_chunk_overlap` is always smaller than `config.default_chunk_size`.

### Rules every intent follows

Field names on the wire are the json tags, all snake_case. IDs are strings, timestamps are RFC 3339 strings.

Every list takes `limit` and `offset` and answers `items`, `total`, `limit` and `offset`. A limit of 0 (or no limit) means 25, anything over 100 is clamped to 100, and the answer echoes the limit it applied, so read `limit` from the response and not from what you sent. A negative `limit` or `offset` is `BAD_REQUEST`. Collections and documents come back newest first. Chunks do not: `chunks.list` is ordered by document ID and then by chunk index, so the page can show a document's chunks in reading order. Do not put a sort control on any of the three.

The dashboard resolves no tenant, so it is operator-wide. The one exception is `documents.ingest`, which writes the document, its chunks and its vectors into the target collection's own tenant (see that intent). The list and retrieval intents take an optional `tenant`. Leave it out (or send `null`) and you get every tenant. Send a string and you get an exact match, and that includes `""`, which means rows written with no tenant. Those are different requests, so a tenant picker needs an "all" choice that omits the field. The get-by-ID intents take no tenant, and the counts on `collections.get` span every tenant.

Arrays are never `null`: `items`, `spans`, `newest_documents`, `hits`, `left_out`, `included`, `extensions` and each extension's `hooks` are `[]` when empty. `metadata` on a collection, document or chunk is `{}` when empty. Fields tagged `omitempty` are simply absent when empty, and the Go source below says which: on a collection `description`, on a document `title`, `source`, `source_type` and `error`, on a chunk `parent_id`, and on a pipeline component `type`, `params`, `score`, `tenant_filter`, `children`, `content_types` and `dimensions`. Guard those.

Retrieval hits are the exception to the `{}` rule, and they can be partial. A hit's `chunk` can be `null` (a custom retriever returned no chunk). An orphaned hit (the vector is there, the chunk row is gone) and an unidentified one (no chunk ID) carry `document_id` and `collection_id` as `""`, `index`, `start_offset`, `end_offset` and `token_count` as 0, and `created_at` as `"0001-01-01T00:00:00Z"`. An unidentified hit's `chunk.metadata` can be `null`. Don't render that `created_at` as a date or an empty ID as a link; check `orphaned`, `hydrated` and the ID first.

No response carries a vector or an embedding. A Go test marshals every handler's answer and fails if either word shows up as a key.

A command's `invalidates` list reaches the client with the answer. You don't invalidate by hand. `retrieval.run` and `retrieval.assemble` invalidate nothing because they write nothing. They are commands so that they fire only when somebody presses Run, never on a window refocus. Don't wire anything to refetch them, and don't call them from a `useEffect`.

#### Limits and defaults

Two kinds of cap. `limit`, `top_k` and `max_tokens` are clamped: an oversized value is cut down and the request goes ahead. The `query`, ingest `content` and assemble caps reject: past them the request answers `BAD_REQUEST` and nothing runs.

Above all of them sits forge's own limit on the whole request envelope, 1 MiB by default (`contract_max_body_bytes` in the dashboard's config, `dashboard.WithContractMaxBodyBytes` in Go). The transport refuses a bigger body with HTTP 413 and `BAD_REQUEST` "request body exceeds 1048576 bytes" before Weave sees it. JSON escaping can double a text file (each quote, backslash and newline becomes two bytes, a control character six), so content under Weave's 1 MiB cap can still hit the transport's limit. Measure the serialized request on the client before you send it, and when it's too big, say which limit it hit: Weave's 1 MiB of content, or the transport's 1 MiB for the whole request (which the operator can raise, to about 3 MiB for files near Weave's cap).

| what | value | past it |
|---|---|---|
| the whole request envelope | 1 MiB unless `contract_max_body_bytes` raises it | HTTP 413, `BAD_REQUEST` from the transport |
| list `limit` | default 25, max 100 | clamped to 100 and echoed |
| `retrieval.run` `query` | 8 KiB (8192 bytes) | `BAD_REQUEST` |
| `retrieval.run` `top_k` | 0 means the engine default, which is `config.default_top_k` from `system.components`; max 50 | clamped to 50; negative is `BAD_REQUEST` |
| `max_tokens` (run and assemble) | 0 means 4096; max 32768 | clamped to 32768; negative is `BAD_REQUEST`; `context.max_tokens` in the answer is the budget that applied |
| `documents.ingest` `content` | 1 MiB (1048576 bytes) | `BAD_REQUEST` |
| `documents.spans` | 5000 spans | `complete: false`, and `total` is still the full chunk count |
| `retrieval.assemble` | 50 hits, and 1 MiB of `content` across all of them | `BAD_REQUEST` for either |
| `system.overview` `newest_documents` | the 10 newest | none |
| stalled document | still `processing` 15 minutes after its last update | `stalled_after_seconds` says 900 |

#### Errors

Errors come back typed, with a code and a `message`. Weave's handlers answer the five below. The framework can answer others before a handler runs: `UNAUTHENTICATED` (a signed-out user or a bad CSRF token), `PERMISSION_DENIED`, `RATE_LIMITED`, `UNSUPPORTED_VERSION`, and its own `BAD_REQUEST` for an oversized body or a malformed envelope. Handle those generically.

| code | when |
|---|---|
| `BAD_REQUEST` | a missing or unparseable ID, a negative `limit` or `offset`, a `state` that isn't one of the four, empty or oversized `content` or `query`, a negative size or token count, a blank collection name, an overlap that isn't smaller than the size, or a cap above. The message is the reason and is safe to show |
| `NOT_FOUND` | a get, update, delete, reindex or ingest names a collection, document or chunk that doesn't exist. A list filtered by an ID that doesn't exist is not a 404: it answers an empty page |
| `CONFLICT` | a collection name that already exists in the same tenant (create or rename; names are unique per tenant), or a document whose exact content is already in that collection, failed and stalled copies included |
| `UNAVAILABLE` | Weave is missing a stage: no store, no embedder, no vector store or no chunker, and the message names which. Also a cancelled or timed-out request, which carries `retryable: true`. `documents.ingest` and `collections.reindex` are the exceptions: their engine work runs on past a cancelled request, so a closed tab doesn't leave a document in `processing` or a collection half indexed |
| `INTERNAL` | anything else. The message is always "an internal error occurred" and the real error goes to Weave's log, because a store error can carry a DSN or a host |

Any query or command that reads the store can answer `UNAVAILABLE` (no store) or `INTERNAL` (the store failed). The per-intent lists below only repeat them where something specific applies.

### The shapes

First the Go, then what they look like flattened, because the embedding is easy to misread.

```go
// extension/contract/paging.go
// page is embedded in every list input: `limit` and `offset` in, matching
// the stores' offset paging.
type page struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

// listOutput is every list's answer: `items` and `total`, plus the limit
// and offset actually applied, so a page can show where it is.
type listOutput[T any] struct {
	Items  []T   `json:"items"`
	Total  int64 `json:"total"`
	Limit  int   `json:"limit"`
	Offset int   `json:"offset"`
}

// extension/contract/rows.go
// tenantInput is the input of an intent whose only parameter is the tenant
// filter: absent means every tenant, present is an exact match.
type tenantInput struct {
	Tenant *string `json:"tenant"`
}

// stateCounts is how many documents sit in each state.
type stateCounts struct {
	Pending    int64 `json:"pending"`
	Processing int64 `json:"processing"`
	Ready      int64 `json:"ready"`
	Failed     int64 `json:"failed"`
}

// documentRow is a document as the dashboard lists it: the stored row,
// its collection's name, and whether it looks stalled.
type documentRow struct {
	*document.Document
	CollectionName string `json:"collection_name"`
	// Stalled is true for a document still processing StalledAfter after
	// its last update. Weave has no heartbeat, so this is an age, not a
	// verdict.
	Stalled bool `json:"stalled"`
}

// extension/contract/handlers_collections.go
type idInput struct {
	ID string `json:"id"`
}

type idOutput struct {
	ID string `json:"id"`
}

// collectionRow is a collection with LIVE document and chunk counts. The
// stored count columns are never updated, so these fields shadow them.
type collectionRow struct {
	*collection.Collection
	DocumentCount int64 `json:"document_count"`
	ChunkCount    int64 `json:"chunk_count"`
}

type collectionDetail struct {
	collectionRow
	DocumentsByState stateCounts `json:"documents_by_state"`
	Stalled          int64       `json:"stalled"`
}
```

The domain types they embed or carry. Storage (`bun`) tags are dropped from these four, since they say nothing about the wire; the json tags are exactly as written in the source.

```go
// entity.go (package weave)
// Entity is the base type embedded by all weave domain objects.
type Entity struct {
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// collection/collection.go
// Collection represents a named group of documents with shared
// embedding and chunking configuration.
type Collection struct {
	weave.Entity

	ID             id.CollectionID   `json:"id"`
	Name           string            `json:"name"`
	Description    string            `json:"description,omitempty"`
	TenantID       string            `json:"tenant_id"`
	AppID          string            `json:"app_id"`
	EmbeddingModel string            `json:"embedding_model"`
	EmbeddingDims  int               `json:"embedding_dims"`
	ChunkStrategy  string            `json:"chunk_strategy"`
	ChunkSize      int               `json:"chunk_size"`
	ChunkOverlap   int               `json:"chunk_overlap"`
	Metadata       map[string]string `json:"metadata"`
	DocumentCount  int64             `json:"document_count"`
	ChunkCount     int64             `json:"chunk_count"`
}

// document/document.go
// Document represents an ingested document within a collection.
type Document struct {
	weave.Entity

	ID            id.DocumentID     `json:"id"`
	CollectionID  id.CollectionID   `json:"collection_id"`
	TenantID      string            `json:"tenant_id"`
	Title         string            `json:"title,omitempty"`
	Source        string            `json:"source,omitempty"`
	SourceType    string            `json:"source_type,omitempty"`
	ContentHash   string            `json:"content_hash"`
	ContentLength int               `json:"content_length"`
	ChunkCount    int               `json:"chunk_count"`
	Metadata      map[string]string `json:"metadata"`
	State         State             `json:"state"`
	Error         string            `json:"error,omitempty"`
}

// chunk/chunk.go
// Chunk represents a portion of a document that has been split for
// embedding and retrieval.
type Chunk struct {
	ID           id.ChunkID        `json:"id"`
	DocumentID   id.DocumentID     `json:"document_id"`
	CollectionID id.CollectionID   `json:"collection_id"`
	TenantID     string            `json:"tenant_id"`
	Content      string            `json:"content"`
	Index        int               `json:"index"`
	StartOffset  int               `json:"start_offset"`
	EndOffset    int               `json:"end_offset"`
	TokenCount   int               `json:"token_count"`
	Metadata     map[string]string `json:"metadata"`
	ParentID     string            `json:"parent_id,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}
```

`document.State` is the string type behind a document's `state`, and its four values are `pending`, `processing`, `ready` and `failed`.

Go's JSON rules flatten every embedded struct, and where an outer field has the same tag as an inner one the outer wins. So the shapes on the wire are these. Types are TypeScript's; `?` marks a field that can be absent.

```text
list<T>             items: T[], total: number, limit: number, offset: number

collectionRow       created_at, updated_at: string
                    id, name: string
                    description?: string
                    tenant_id, app_id: string
                    embedding_model: string
                    embedding_dims: number
                    chunk_strategy: string
                    chunk_size, chunk_overlap: number
                    metadata: Record<string, string>
                    document_count, chunk_count: number    live counts; the stored ones are shadowed

collectionDetail    every collectionRow field, then
                    documents_by_state: { pending, processing, ready, failed: number }
                    stalled: number

documentRow         created_at, updated_at: string
                    id, collection_id, tenant_id: string
                    title?, source?, source_type?: string
                    content_hash: string
                    content_length, chunk_count: number
                    metadata: Record<string, string>
                    state: "pending" | "processing" | "ready" | "failed"
                    error?: string
                    collection_name: string                "" once the collection is deleted
                    stalled: boolean

chunk               id, document_id, collection_id, tenant_id: string
                    content: string
                    index, start_offset, end_offset, token_count: number
                    metadata: Record<string, string>
                    parent_id?: string
                    created_at: string
```

`collection_name` on a document row is the only place a blank name is legitimate. A deleted collection gives `""`. A failed name lookup does not give a blank: the whole request answers `INTERNAL` instead. The engine types (`Components`, `Component`, `ComponentInfo`, `ExtensionInfo`, `CompareResult`, `CompareHit`, `ScoredChunk`, `AssembledContext`) are unchanged from the slice 1 section above and are copied there verbatim, with their embedding spelled out. The rest of the handler structs sit with the intents that use them.

### The 17 intents

Nine queries and eight commands, grouped by area. "Input" and "Output" name the Go struct; the field list is in the block under each group.

#### Overview and pipeline

```go
// extension/contract/handlers_system.go
type overviewOutput struct {
	Collections         int64             `json:"collections"`
	Documents           int64             `json:"documents"`
	DocumentsByState    stateCounts       `json:"documents_by_state"`
	Chunks              int64             `json:"chunks"`
	Stalled             int64             `json:"stalled"`
	StalledAfterSeconds int               `json:"stalled_after_seconds"`
	NewestDocuments     []documentRow     `json:"newest_documents"`
	Components          engine.Components `json:"components"`
	// Scope is "all": the dashboard path resolves no tenant, so it sees
	// every tenant's data unless a page filters by one.
	Scope string `json:"scope"`
}

// engineConfig is the engine's configuration as the engine holds it. The
// recorded-but-unused defaults (model, strategy) are listed because they
// are what new collections record. IngestConcurrency is left out: the
// engine never reads it.
type engineConfig struct {
	DefaultChunkSize       int     `json:"default_chunk_size"`
	DefaultChunkOverlap    int     `json:"default_chunk_overlap"`
	DefaultEmbeddingModel  string  `json:"default_embedding_model"`
	DefaultChunkStrategy   string  `json:"default_chunk_strategy"`
	DefaultTopK            int     `json:"default_top_k"`
	ShutdownTimeoutSeconds float64 `json:"shutdown_timeout_seconds"`
}

type componentsOutput struct {
	Components engine.Components      `json:"components"`
	Config     engineConfig           `json:"config"`
	Extensions []engine.ExtensionInfo `json:"extensions"`
}
```

`system.overview`
- query. Input `tenantInput`. Output `overviewOutput`.
- `components` is the engine's `Components` as in slice 1. `scope` is always `"all"`, even when you pass a `tenant`, because it describes the dashboard and not the filter.
- `stalled` counts documents still `processing` more than `stalled_after_seconds` after their last update. Weave has no heartbeat, so this is an age and not a verdict; say "looks stalled".
- Errors: only the store ones. A failed lookup of a newest document's collection name is `INTERNAL`, not a blank `collection_name`.

`system.components`
- query. Input none (send `{}`). Output `componentsOutput`.
- `config` is what the engine holds, YAML included. `default_embedding_model` and `default_chunk_strategy` are what a new collection records; Weave writes them down and never reads them back, and the form should say so. `IngestConcurrency` is left out on purpose because the engine never reads it. `shutdown_timeout_seconds` is a float.
- Errors: none. It reads memory.

#### Collections

```go
// extension/contract/handlers_collections.go
type collectionsListInput struct {
	page
	Tenant *string `json:"tenant"`
	Search string  `json:"search"`
}

type collectionCreateInput struct {
	Name         string            `json:"name"`
	Description  string            `json:"description"`
	ChunkSize    int               `json:"chunk_size"`
	ChunkOverlap int               `json:"chunk_overlap"`
	Metadata     map[string]string `json:"metadata"`
}

type collectionUpdateInput struct {
	ID          string             `json:"id"`
	Name        *string            `json:"name"`
	Description *string            `json:"description"`
	Metadata    *map[string]string `json:"metadata"`
}

type reindexOutput struct {
	ID                 string  `json:"id"`
	ReindexedDocuments int64   `json:"reindexed_documents"`
	ElapsedMillis      float64 `json:"elapsed_ms"`
}
```

`collections.list`
- query. Input `collectionsListInput`. Output `list<collectionRow>`.
- `search` is a case-insensitive substring match on the name. Newest first.
- Errors: `BAD_REQUEST` for a negative `limit` or `offset`.

`collections.get`
- query. Input `idInput`. Output `collectionDetail`.
- Errors: `BAD_REQUEST` (missing or unparseable `id`), `NOT_FOUND`.

`collections.create`
- command. Input `collectionCreateInput`. Output `collectionRow` (the new collection, with both counts at 0). Invalidates `collections.list`, `system.overview`.
- `name` is trimmed. A `chunk_size` or `chunk_overlap` of 0 means the engine default, and that is a problem for the form: an overlap of 0 means "the default", because the engine treats 0 that way, so the form cannot create a collection with no overlap. Say so next to the field. Validation compares the effective overlap with the effective size, so `chunk_overlap: 600` with no size fails against `config.default_chunk_size` (512 unless the YAML sets it), and `chunk_size: 40` with no overlap fails against `config.default_chunk_overlap` (50 unless the YAML sets it). The message names the effective values and which came from the defaults, for example "chunk overlap 50 (the default) must be smaller than chunk size 40". Show it as it is.
- `embedding_dims` is recorded from the wired embedder. The model and strategy are the engine's defaults, and you can't set them here.
- The new collection's `tenant_id` is `""`, since the dashboard resolves none.
- Errors: `BAD_REQUEST` (blank name, negative size or overlap, effective overlap not smaller than effective size), `CONFLICT` (the name exists in that tenant), `UNAVAILABLE` (no store).

`collections.update`
- command. Input `collectionUpdateInput`. Output `collectionRow`. Invalidates `collections.list`, `collections.get`, `documents.list`, `documents.get`, `system.overview` (the last three render `collection_name`, so a rename has to refresh them).
- Every field except `id` is a pointer and a missing or `null` one is left alone. `metadata: {}` clears the metadata, and a non-empty map replaces it whole; it does not merge. Chunk size, overlap and the recorded model, dimensions and strategy can't change after creation, so don't offer them on the edit form.
- Errors: `BAD_REQUEST` (bad `id`, or a blank or whitespace-only `name`), `NOT_FOUND`, `CONFLICT` (another collection in the same tenant has the new name).

`collections.delete`
- command. Input `idInput`. Output `idOutput`. Invalidates `collections.list`, `collections.get`, `documents.list`, `chunks.list`, `system.overview`.
- It removes the collection's chunks and documents too. Deleting the same collection twice answers `NOT_FOUND` the second time. If clearing the vector store fails, Weave logs it and still answers success.
- Errors: `BAD_REQUEST`, `NOT_FOUND`.

`collections.reindex`
- command. Input `idInput`. Output `reindexOutput`. Invalidates `collections.get`, `system.overview`.
- It re-embeds the collection's `ready` documents inside the request, so it can run for a while. `reindexed_documents` is how many `ready` documents there were when it started, and `elapsed_ms` is a float.
- It deletes every vector in the collection before it re-embeds, and the work runs on past a cancelled request, so closing the tab doesn't stop it partway.
- Errors: `BAD_REQUEST`, `NOT_FOUND` (checked first, because the engine alone would report success for an ID that doesn't exist), `UNAVAILABLE` (no embedder or no vector store). An embedder that fails halfway is `INTERNAL`, with the generic message. An `INTERNAL` or `UNAVAILABLE` from a reindex that had started leaves the collection partly indexed: some documents have their vectors back and the rest have none. Say that next to the error, and offer to run the reindex again; the generic message alone doesn't tell anyone their search is now missing documents.

#### Documents

```go
// extension/contract/handlers_documents.go
type documentsListInput struct {
	page
	CollectionID string  `json:"collection_id"`
	State        string  `json:"state"`
	Search       string  `json:"search"`
	Tenant       *string `json:"tenant"`
}

type span struct {
	ID          string `json:"id"`
	Index       int    `json:"index"`
	StartOffset int    `json:"start_offset"`
	EndOffset   int    `json:"end_offset"`
	TokenCount  int    `json:"token_count"`
}

// spansOutput lays a document's chunks out as byte ranges. Offsets are into
// the text after the loader extracted it and after trimming; the semantic
// and code chunkers approximate them.
type spansOutput struct {
	DocumentID    string `json:"document_id"`
	ContentLength int    `json:"content_length"`
	Spans         []span `json:"spans"`
	Total         int64  `json:"total"`
	Complete      bool   `json:"complete"`
}

type ingestInput struct {
	CollectionID string            `json:"collection_id"`
	Title        string            `json:"title"`
	Source       string            `json:"source"`
	SourceType   string            `json:"source_type"`
	Content      string            `json:"content"`
	Metadata     map[string]string `json:"metadata"`
}

// ingestOutput is the result of one synchronous ingest. A failed ingest is
// an answer: the document row exists in state failed, and Error is the
// reason Weave stored on it.
type ingestOutput struct {
	DocumentID string `json:"document_id"`
	State      string `json:"state"`
	ChunkCount int    `json:"chunk_count"`
	Error      string `json:"error,omitempty"`
}
```

`documents.list`
- query. Input `documentsListInput`. Output `list<documentRow>`.
- `state` is `""`, `pending`, `processing`, `ready` or `failed`. `collection_id` is optional. `search` is a case-insensitive substring match on the title. Newest first.
- Errors: `BAD_REQUEST` (any other `state`, an unparseable `collection_id`, a negative `limit` or `offset`). A `collection_id` that parses but doesn't exist answers an empty page. A failed lookup of a row's collection name is `INTERNAL`, never a blank `collection_name`.

`documents.get`
- query. Input `idInput`. Output `documentRow`.
- Errors: `BAD_REQUEST`, `NOT_FOUND`, and `INTERNAL` if the collection-name lookup fails (a deleted collection is fine and gives `""`).

`documents.spans`
- query. Input `idInput`. Output `spansOutput`.
- Spans are the document's chunks in index order, up to 5000. `total` is the real chunk count and `complete` is false past the cap.
- `content_length` is the raw input length, set before any loader runs. `start_offset` and `end_offset` are offsets into the text after the loader ran and the text was trimmed. For plain text the two share a scale. When a loader changed the text (HTML, markdown) they don't, and a span map drawn against `content_length` will stop short. Scale it against the largest `end_offset`, or show both numbers and say which is which. The semantic and code chunkers only approximate their offsets.
- Errors: `BAD_REQUEST`, `NOT_FOUND`.

`documents.ingest`
- command. Input `ingestInput`. Output `ingestOutput`. Invalidates `documents.list`, `chunks.list`, `collections.list`, `collections.get`, `system.overview`.
- It runs the whole pipeline inside the request, on a context the request's cancellation doesn't reach, so a closed tab or a proxy timeout doesn't leave the document in `processing`. `source_type` selects the loader when one supports it, and the supported types are `components.loader.content_types`.
- The document, its chunks and its vectors go into the collection's own tenant and app. Ingest into a collection owned by `acme` and the document shows under `tenant: "acme"` and not under `tenant: ""`.
- A failed ingest is an answer, not an error. If the document row was written and a later stage failed (the embedder, say), you get a normal response with `state: "failed"`, the stored reason in `error`, and `chunk_count` 0. The command succeeds as far as the client is concerned, so branch on `state` in `onSuccess` and link to the document. `chunk_count: 0` describes the answer, not the store: when the vector upsert is what failed, the chunk rows were already written, and `chunks.list` for that document shows them. `error` is the engine's raw text and can carry backend detail (a host, a provider's message), so show it in the document's alert and nowhere more public. A good ingest answers `state: "ready"`, `chunk_count` and no `error` key.
- A duplicate (the same content already in that collection) is an error, `CONFLICT`, and no row is created. The earlier copy can be one that failed or stalled, and the message says so: "this collection already has a document with exactly the same content (including a failed or stalled one; delete it to ingest again)". With that CONFLICT, offer a link to Documents filtered to this collection and to `state: "failed"` (and `processing`), so the operator can find the copy and delete it.
- Errors: `BAD_REQUEST` (missing or unparseable `collection_id`, content that is empty or only whitespace, more than 1 MiB; or the transport's own for a request envelope over its limit, see Limits), `NOT_FOUND` (the collection), `CONFLICT`, `UNAVAILABLE` (no store, embedder, vector store or chunker; the message names it).

`documents.delete`
- command. Input `idInput`. Output `idOutput`. Invalidates `documents.list`, `documents.get`, `chunks.list`, `collections.list`, `collections.get`, `system.overview`.
- Errors: `BAD_REQUEST`, `NOT_FOUND`.

#### Chunks

```go
// extension/contract/handlers_chunks.go
type chunksListInput struct {
	page
	DocumentID   string  `json:"document_id"`
	CollectionID string  `json:"collection_id"`
	Tenant       *string `json:"tenant"`
}

// chunkDetail is one chunk with its neighbours in its document. An empty
// previous_id or next_id means there is none.
type chunkDetail struct {
	Chunk         *chunk.Chunk `json:"chunk"`
	DocumentTitle string       `json:"document_title"`
	PreviousID    string       `json:"previous_id"`
	NextID        string       `json:"next_id"`
}
```

`chunks.list`
- query. Input `chunksListInput`. Output `list<chunk>`, each item a bare chunk object, not wrapped.
- It needs a `document_id` or a `collection_id`, and with neither it answers `BAD_REQUEST`; an unscoped listing is a table scan nobody wants. With both, both apply. Ordered by document, then index, and not newest first.
- Errors: `BAD_REQUEST` (no scope, an unparseable ID, a negative `limit` or `offset`). An ID that parses but doesn't exist answers an empty page.

`chunks.get`
- query. Input `idInput`. Output `chunkDetail`, with the chunk under the `chunk` key.
- `previous_id` and `next_id` are `""` when there is none. They assume a document's chunks are numbered from 0 with no gaps, which the chunkers guarantee.
- An orphaned chunk (the chunk row exists and its document row is gone) opens normally, with `document_title` `""`. `chunks.list` shows such chunks, so the detail page has to be able to open them. Treat an empty title as "document deleted" and not as a failure.
- Errors: `BAD_REQUEST`, `NOT_FOUND` (the chunk). Any other failure looking up the document is mapped the usual way.

#### Retrieval

```go
// extension/contract/handlers_retrieval.go
type runInput struct {
	Query        string  `json:"query"`
	CollectionID string  `json:"collection_id"`
	Tenant       *string `json:"tenant"`
	TopK         int     `json:"top_k"`
	MinScore     float64 `json:"min_score"`
	MaxTokens    int     `json:"max_tokens"`
}

// runOutput is one retrieval run: the configured ranking beside the raw
// vector ranking, and what Weave's default assembler builds from it.
type runOutput struct {
	Result  *engine.CompareResult    `json:"result"`
	Context *engine.AssembledContext `json:"context"`
}

// assembleHit is one hit of an earlier run, echoed back exactly as the run
// returned it. chunk_id is "" for a hit a custom retriever did not identify.
// content is null for a hit that had no chunk at all: the run skipped it,
// so re-assembly skips it too.
type assembleHit struct {
	ChunkID string  `json:"chunk_id"`
	Content *string `json:"content"`
	Score   float64 `json:"score"`
}

type assembleInput struct {
	Hits      []assembleHit `json:"hits"`
	MaxTokens int           `json:"max_tokens"`
}
```

`retrieval.run`
- command. Input `runInput`. Output `runOutput`: `result` is the `CompareResult` and `context` the `AssembledContext`, both as in slice 1. Invalidates nothing.
- `top_k` 0 is the engine default and over 50 is clamped. `min_score` applies to the final hits only. `collection_id` is optional and, like the list filters, an ID that doesn't exist just finds nothing. `max_tokens` 0 is 4096, over 32768 is clamped.
- It needs Weave's own embedder and vector store. When either is missing it answers `UNAVAILABLE` before touching the engine, with "retrieval needs Weave's own embedder and vector store; this deployment has no embedder configured", or the same with "no vector store configured". Show that message as it is; a deployment that retrieves through a retriever alone can't use this page.
- Errors: `BAD_REQUEST` (a blank query, a query over 8 KiB, a negative `top_k` or `max_tokens`, an unparseable `collection_id`), `UNAVAILABLE`. An embedder that fails during a run is `INTERNAL` with the generic message; the cause is in Weave's log.

`retrieval.assemble`
- command. Input `assembleInput`. Output `AssembledContext` itself, not wrapped in anything. Invalidates nothing.
- Its input is not what the slice 3 plan said. It does not take `chunk_id` and `score` pairs. It takes `hits`, each `{chunk_id, content, score}`, echoed from a `retrieval.run` result, plus `max_tokens`. For each entry in `result.hits`, in order, send `chunk_id` as the hit's `chunk.id` (or `""` when `chunk` is null or has no ID, the unidentified case), `content` as `chunk.content` and `score` as the hit's `score`. `content` is `string | null`: when the hit's `chunk` is `null`, send `content: null`. The run's assembler skipped that hit, and a `null` makes re-assembly skip it too. Sending `""` instead would add an empty `[n]` entry and shift every marker after it.
- It is pure re-assembly. It reads no store, embeds nothing and is never `NOT_FOUND`. The same hits and the same `max_tokens` give exactly the context `retrieval.run` gave, orphans included. That is the reason for the shape: an orphaned hit (the vector is there, the chunk row is gone) is part of what an app would hand its model, and re-reading by ID could never rebuild it. The `included` and `first_excluded` positions refer to the `hits` you sent, in the order you sent them.
- A `chunk_id` that doesn't parse is treated as `""`. It is not an error.
- Errors: `BAD_REQUEST` (more than 50 hits, more than 1 MiB of non-null `content` in total, a negative `max_tokens`). Nothing else is specific to it.

### Where this section corrects the text above

- The intent table in "The contract package" says `retrieval.assemble` re-assembles from `chunk_id` and `score` pairs. It takes `hits` with `content`, as above.
- The slice 1 section says `ChunkRef` is the input of `AssembleRefs`, "which `retrieval.assemble` calls". It no longer does. `AssembleRefs` still exists in the engine and the contract never calls it, so don't type `ChunkRef` into the plugin.
- The slice table and "Retiring the templ dashboard" put the templ deletion after the browser walk. It is already done, so the browser walk has nothing left to retire.
- Lists are newest first for collections and documents only. `chunks.list` is ordered by document and index.
- "Document detail" in the React half drew the span map along a bar `content_length` wide. Draw it against the largest `end_offset`, as `documents.spans` says. That section now says so too.
- The intent table in "The contract package" gave `collections.update` only `collections.list` and `collections.get`. A rename also invalidates `documents.list`, `documents.get` and `system.overview`, and the table now says so.

### Commits

Weave `main`, oldest first. `0d29d1b` was the last commit of slice 1, so everything below is slice 3. Nothing is pushed.

| commit | what it did |
|---|---|
| `4772ecc` | docs: record what the templ dashboard did before it goes |
| `9221db3` | chore: delete the templ dashboard |
| `79ca320` | docs: say what the moved dashboard items still wait on |
| `d691ab5` | chore(deps): move to forge v1.12.0 and drop templ and forgeui |
| `e182a38` | feat(contract): lay the weave contract's foundation |
| `1eafdd2` | feat(contract): answer the overview and the component report |
| `d37caed` | fix(contract): report a failed collection lookup instead of a blank name |
| `95923a6` | feat(contract): list, create, edit, delete and reindex collections |
| `9404599` | feat(contract): list, read, ingest and delete documents |
| `9391773` | feat(contract): page chunks and read one with its neighbours |
| `bdf494c` | fix(contract): open an orphaned chunk instead of calling it missing |
| `bf7ba40` | feat(contract): run a query side by side and re-assemble its context |
| `d179a95` | fix(contract): re-assemble exactly the hits a run returned |
| `07b34ff` | test(contract): bind every intent, carry invalidates, never send a vector |
| `df0a253` | feat(extension): register the weave contract and hand the engine its config |
| `05a1ba8` | fix(contract): skip a hit with no chunk when re-assembling, as the run did |
| `3f198d3` | fix(contract): say a duplicate may be a failed or stalled copy |
| `13481eb` | fix(contract): check every binding before registering the manifest |
| `d7548cb` | fix(contract): name the effective chunk values when an overlap is refused |
| `fab31de` | fix(contract): ingest under the collection's tenant and let ingest and reindex finish |
| `c107fc6` | fix(contract): refresh document views and the overview after a rename |
| `9bfe592` | test(contract): keep the overview's newest-first rows from tying on the clock |
| `d1b6960` | test(contract): show the transport's 1 MiB envelope limit refusing content under Weave's cap |
| `6980d08` | fix(extension): refuse a default chunk overlap at or above the chunk size |
| `5495ebb` | docs: bring MIGRATION.md up to the contract as it stands |

The last ten came out of the final review. At `5495ebb`, with both test databases up: `go build`, `go vet` and `go test -count=1 ./...` pass, the store conformance suite runs with 0 skips on all four backends, `gofmt -l .` is empty, and a fresh-cache `golangci-lint run ./...` reports `0 issues.`
