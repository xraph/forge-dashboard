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
| `collections.update` | command | invalidates `collections.list`, `collections.get` |
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

The span map draws chunks as byte ranges along a bar `content_length` wide,
shades overlap with the previous chunk, and flags gaps as bytes no chunk
covers. Its caption says the offsets are byte offsets into the text after
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
