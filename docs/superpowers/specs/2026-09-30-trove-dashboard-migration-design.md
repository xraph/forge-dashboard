# Trove dashboard: templ to React shell

Status: design approved in conversation on 2026-09-30, awaiting review of this
written spec.

Two repositories:

- Go: `/Users/rexraphael/Work/xraph/forgery/trove`, branch `main`. The root
  module is `github.com/xraph/trove`; the extension is its own module at
  `trove/extension` with `replace github.com/xraph/trove => ..`.
- React: this repo, as a new `packages/plugin-trove`.

Read `packages/plugin/PLAYBOOK.md` before touching either half. This spec
assumes you have.

## What this is for

You run Trove to put objects in buckets across six backends, and today the
dashboard that ships with it cannot show you a single object you stored. The
templ pages read a metadata store that normal operation never writes to, their
upload and download buttons call HTTP routes that are never mounted, and the
Settings page reports encryption as enabled on deployments where nothing is
encrypted. So this migration builds on the parts of Trove that hold your
data: the drivers, the middleware resolver, the CAS engine and the stream
pool.

When it's done you can:

- browse any bucket in any configured store, by prefix and by folder where the
  driver reports folders, with paging that works on every backend;
- see what a driver stored for a key, and which middleware is configured to
  apply to that key now;
- upload and download real files, through Trove's middleware, on every driver,
  local and SFTP included;
- see what protection is configured against what is actually applied;
- look into the CAS index and the in-process streams without being told
  anything they cannot back up.

And the templ dashboard is gone from the extension.

## What the investigation found

Five read-only passes over the Go source, 2026-09-30. Every claim here was
checked against the code with a file and line; the long form lives in
`trove/MIGRATION.md` once written (see "Findings for MIGRATION.md").

### The metadata store has almost no writers

`extension/store` defines buckets, objects, upload sessions, CAS entries and
quotas across memory, SQLite, Postgres and Mongo. Almost nothing writes them.

- `trove.Put`, `Delete` and `Copy` go straight to the driver. The root module
  cannot import the extension, so it never could.
- The only `CreateObject` call in the tree is the templ dashboard's own Copy
  button, and it discards the error.
- `CreateUploadSession`, `PutCASEntry`, `IncrementCASRef`, `DecrementCASRef`
  and `UpdateQuotaUsage` have no callers at all.
- Buckets get a row only when created through the templ form. The default
  bucket the extension creates at start gets none.
- The HTTP handler package (`extension/handler`) is complete and never
  mounted. `registerRoutes` is an empty placeholder, and nothing in forgery
  calls `handler.New`. Its upload handlers are stubs anyway.
- `SetQuota` and `PutCASEntry` on Postgres and SQLite emit
  `ON CONFLICT (...) DO UPDATE` with no SET clause, which both databases
  reject. Creating a quota from the templ page fails there.

So every templ page that reads objects, uploads, CAS entries or quota usage
reads a table nothing fills. This dashboard reads the drivers and never the
metadata store. The store stays in the extension, untouched.

### What the drivers can list and count

| | Prefix | Delimiter | Cursor today | Cost per page | Count |
|---|---|---|---|---|---|
| local | yes, in Go | ignored | last key, works | walks the whole bucket | none |
| mem | yes, in Go | ignored | last key, works | scans the whole map | none |
| sftp | yes, in Go | ignored | last key, works | recursive ReadDir of the bucket | none |
| s3 | server side | sent, `CommonPrefixes` dropped | broken | one page | none |
| gcs | server side | emits `Key:""` rows | last key, rescans | grows with the page number | none |
| azure | server side | ignored | broken | one page | none |

S3 sends your cursor as `StartAfter`, which is a key, and returns S3's opaque
continuation token as `NextToken`. Feed the token back and you get the wrong
page. Azure has the mirror bug: it passes a blob name as the opaque `Marker`.
GCS turns each common prefix into an `ObjectInfo` with an empty key and every
field zero, which counts against `MaxKeys` and vanishes on later pages.

No driver can count objects or sum bytes without a full scan. None implements
`VersioningDriver`, `LifecycleDriver`, `NotificationDriver` or
`ServerCopyDriver`; the interfaces exist only in `driver/capability.go`.

ETags are content hashes only where the backend makes them so. On mem the ETag
is the length in hex, so equal-length objects share one. On local, SFTP and
Azure, `Put` returns a synthetic ETag that differs from what `Head` returns.

`DeleteBucket` on a non-empty bucket is recursive on local, mem, SFTP and
Azure, and an unclassified error on S3 and GCS.

The conformance suite (`trovetest`) runs in CI against mem and local only. The
S3, GCS, Azure and SFTP runs sit behind an `integration` build tag that CI
never sets, and as written they probably could not pass.

### Middleware records nothing per object

`WrapWriter` receives `(ctx, w, key)` and nothing else, `Trove.Put` hands the
caller's options to the driver unchanged, and no middleware writes a sidecar.
So nothing about a stored object tells you which middleware it went through.

- **encrypt** writes a four-byte nonce length, the nonce and the GCM output.
  No magic, no key id. Reading plaintext through it fails, or panics inside
  the standard library for some inputs.
- **compress** writes a zstd frame and sniffs the magic on read, so an old
  uncompressed object passes through. So does a user's own `.zst` upload,
  which it then silently decompresses on download.
- **scan** keeps no record of anything. It passes through silently with no
  provider configured, for excluded extensions, and for objects over 25 MB.
  The only observable result is a rejected write.
- **dedup** detects and records, and always stores the bytes. It is unrelated
  to CAS.
- **watermark** changes what a download returns and never what is stored.

Four more facts matter to the page:

- `Config.EnableEncryption` never registers the encrypt middleware, in
  single-store or multi-store mode. It reaches only the templ Settings badge,
  which therefore reports encryption on while nothing is encrypted.
- The read pipeline is not reversed. With the documented compress and encrypt
  priorities, a download returns zstd bytes and no error.
- `ScopeContentType` matches the key's extension, badly, and never the content
  type.
- CAS, `Copy` and `Stream` all bypass middleware.

`Resolver.Registrations()` does enumerate what is registered: name, direction
override, scope string and priority. You can call `Scope.Match` yourself. The
middleware's own settings are unexported and cannot be shown.

### Uploads are not resumable, because nothing persists them

`stream/` is an in-memory channel pipe. Its "resumable" option is a flag that
only its own getter reads. The driver multipart APIs exist on S3, GCS and
Azure and nothing in Trove or the extension calls them. The upload-session
table has no writer. After a restart there is nothing to resume and nothing to
abort.

What an abandoned multipart upload would cost, if someone called those APIs
directly: orphan parts billed on S3 until a lifecycle rule runs (Trove sets
none), visible `<key>.part.N` objects on GCS whose state lived in a package
global, and a `.trove-tmp-*` file left on local disk after a crash.

### CAS dedupes and can never release

- Content lives in bucket `cas` under the key `<alg>:<hex>`. The extension
  never creates that bucket, so on memdriver the first `Store` fails.
- The index is in memory. Every refcount and pin is lost on restart, and
  existing blobs become invisible to `Exists` and `Retrieve`.
- A duplicate `Store` increments the refcount. Nothing public decrements it,
  so `GC`, which only collects refcount zero, can never collect anything.
- The `trove_cas_index` table the templ page lists is unrelated to the index
  GC runs against. Pin and unpin on the templ page flip the table, which GC
  never reads.
- Deleting `sha256:...` from the `cas` bucket through the object API leaves a
  dangling index entry. This dashboard refuses that delete.

### Tenancy

There is none on the driver path. `TenantKey` columns exist in the metadata
store and nothing sets them, and there is no scope helper, claim lookup or
`forge.ScopeFrom` anywhere in the extension. The playbook's scope warning has
nothing to bite on here. The dashboard is operator-wide, and the spec says so
rather than inventing a tenant dimension.

### What the 11 templ pages expose of the library

Library calls they make for real: `ListBuckets`, `CreateBucket`, `Copy`,
`Ping`, `Driver().Name()`, three of the seven capability checks, CAS `GC`, and
two pool config values.

Library features they never surface:

- listing objects from the driver, and `Head` with user metadata;
- `Get`, `Put` and `Delete`, except through the unmounted API;
- the middleware resolver;
- multi-store mode, which the templ contributor cannot see past the default
  store;
- presigned URLs (the Generate URL button has no handler);
- range reads, the stream pool and the VFS.

## Decisions

Settled in conversation, 2026-09-30:

1. Content travels through routes the Trove extension mounts, authorised by
   short-lived tickets that contract intents mint. The envelope carries
   metadata and commands only.
2. Trove core gets the browser-path fixes: working cursors on S3 and Azure, a
   common-prefixes result on every driver, GCS stops emitting empty-key rows,
   and small read-only accessors on CAS and streams. Every other defect found
   is recorded in `MIGRATION.md` and raised, not fixed here.
3. Surfaces built on the unwritten metadata store are dropped with a reason
   each. Transfers become a read-only view of the in-process stream pool.
4. The fixture server gets trove-only content routes, and `BASELINE.md` gets
   the re-measured bundle numbers.

## The Go half

### Trove core

All additive. Nothing an existing caller relies on changes shape.

`driver`:

- `ObjectIterator` gains `CommonPrefixes() []string`, and a constructor
  `NewObjectIteratorWithPrefixes(objects, prefixes, nextToken)`. The existing
  constructor keeps returning an iterator with no prefixes.
- Document the paging contract on `ListConfig.Cursor` and `NextToken`:
  `NextToken` is opaque, and you pass it back unchanged as `Cursor`. An empty
  `NextToken` means the listing is complete.
- With a `Delimiter` set, the keys under a common prefix are folded into that
  prefix. Objects and prefixes form one lexicographic sequence, `MaxKeys`
  counts both, and the cursor resumes after the last item emitted, whether it
  was a key or a prefix.

Per driver:

- **local, mem, sftp:** group keys by delimiter after the prefix, inside the
  existing sorted walk. The cursor stays "last emitted item". local and SFTP
  still walk the whole bucket per page; making them read one directory level
  is a later optimisation and not in scope.
- **s3:** read `CommonPrefixes`. Send `Cursor` as `ContinuationToken` and
  return `NextContinuationToken`. Guard `MaxKeys <= 0`.
- **gcs:** map entries that carry only `Prefix` into prefixes. Page with the
  iterator's page token instead of re-streaming from the start of the prefix.
- **azure:** with a delimiter, use the hierarchy pager and map `BlobPrefixes`.
  Send `Cursor` as `Marker` and return `NextMarker`.

`cas`: add `Bucket() string` and `Stat(ctx, hash) (*Entry, error)`, which
reads the index without touching the bucket. `Algorithm()` already exists.

`stream`: add `TotalSize() int64`.

`trovetest` gains cases for delimiter listing, delimiter listing across pages,
and an empty `NextToken` on the last page. They run on mem and local in CI.

### The extension

`RegisterContractContributor` lives beside the existing
`DashboardContributor`. forge v1.10.0, which the extension pins, has both
`DashboardAware` and `ContractContributorAware`, so the two dashboards coexist
until the deletion commit. The `ContractContributorAware` assertion goes in a
`_test.go` file, so production code never imports the dashboard root package.
That is what kept Vault's shipped build to six forge dashboard packages.

New config keys, on `Config` with yaml and json tags:

| key | default | meaning |
|---|---|---|
| `dashboard_content_path` | `/dashboard/trove/content` | where the content routes mount; under the dashboard's default base path so the same proxy carries both |
| `dashboard_max_upload_bytes` | 67108864 (64 MiB) | the largest upload a ticket will allow |
| `dashboard_content_secret` | empty | HMAC key for tickets; empty means a random per-process key |

The 64 MiB default is deliberate. Every Trove middleware buffers the whole
object in memory, and the config docs say that next to the key.

A small resolver maps an optional `store` name to a `*trove.Trove`. In
multi-store mode it goes through `TroveManager`. In single-store mode the only
valid name is the default. An unknown name is `NOT_FOUND`. Falling back to the
default here would answer you with a different store's objects.

### The contract package

`trove/extension/contract/`, shaped like Vault's:

- `contract.go`: `ContributorName = "trove"`, `Deps`, and `Register`, which
  loads and validates the manifest and then registers each intent at version 1.
- `manifest.yaml`: the 20 intents, one line each.
- `handlers_system.go`, `handlers_buckets.go`, `handlers_objects.go`,
  `handlers_content.go`, `handlers_middleware.go`, `handlers_cas.go`,
  `handlers_streams.go`.
- `project.go`: wire types and projections. Times are UTC RFC3339. Absent
  values are JSON `null`, never `0` or `""`.
- `errors.go`: maps driver and trove sentinels to contract codes, as below.
- `tickets.go`: signing and verifying tickets.
- `content.go`: the content routes' `http.Handler`.

Error mapping:

| sentinel | code |
|---|---|
| `ErrObjectNotFound`, `ErrBucketNotFound`, unknown store | `NOT_FOUND` |
| `ErrBucketExists`, key exists without `overwrite` | `CONFLICT` |
| `trove.ErrContentBlocked` | `BAD_REQUEST`, with the threat name in `details` |
| a refused precondition (non-empty bucket, CAS bucket delete, copy across middleware) | `CONFLICT`, with the reason |
| missing or malformed field | `BAD_REQUEST` |
| anything else | `INTERNAL` with a generic message, logged with the intent name |

### The 20 intents

Every intent takes an optional `store`. Paging is cursor-based wherever a list
can grow, `cursor` in and `nextCursor` out, and no list returns a total.

Queries:

| intent | request | response |
|---|---|---|
| `system.status` | `store?` | `store`, `driver`, `health{ok, error}`, `capabilities{multipart, presign, range, serverCopy, versioning, notification, lifecycle, folders}`, `config{defaultBucket, chunkSize, poolSize, maxUploadBytes}`, `flags[{name, configured, applied, note}]`, `etagIsContentHash`, `contentSecret` (`"configured"` or `"per-process"`) |
| `stores.list` | none | `mode` (`"single"` or `"multi"`), `stores[{name, driver, isDefault}]` |
| `buckets.list` | `store?` | `buckets[{name, createdAt}]`, `createdAtMeaning` (`"created"` or `"modified"`) |
| `objects.list` | `store?, bucket, prefix?, delimiter?, cursor?, limit?` | `objects[{key, storedSize, etag, lastModified, contentType, storageClass}]`, `prefixes[]` or `null`, `nextCursor`, `foldersSupported` |
| `objects.head` | `store?, bucket, key` | `object{key, storedSize, etag, lastModified, contentType, storageClass, versionId, metadata}`, `middleware[{name, direction, scope, priority}]`, `presign{available, reason}` |
| `objects.contentUrl` | `store?, bucket, key, purpose, limit?` | `url, expiresAt` |
| `middleware.list` | `store?, bucket?, key?` | `registrations[{name, direction, scope, priority, matchesWrite, matchesRead}]`, `warnings[{code, message}]` |
| `cas.status` | `store?` | `enabled, algorithm, bucket, index, resetsOnRestart, releaseSupported` |
| `cas.list` | `store?, cursor?, limit?` | `entries[{hash, storedSize, lastModified, indexed, refCount, pinned}]`, `nextCursor` |
| `streams.list` | `store?` | `streams[{id, direction, bucket, key, state, offset, totalSize}]`, `active`, `max` |

Commands:

| intent | request | behaviour | invalidates |
|---|---|---|---|
| `buckets.create` | `store?, name` | driver `CreateBucket` | `buckets.list` |
| `buckets.delete` | `store?, name` | lists one key first and refuses a non-empty bucket on every driver | `buckets.list`, `objects.list` |
| `objects.delete` | `store?, bucket, key` | refuses keys in the CAS bucket while CAS is enabled | `objects.list`, `objects.head`, `cas.list` |
| `objects.copy` | `store?, srcBucket, srcKey, dstBucket, dstKey, overwrite` | refuses when source and destination match different middleware | `objects.list`, `objects.head` |
| `objects.beginUpload` | `store?, bucket, key, size, contentType, overwrite` | checks size cap and overwrite, returns `url, expiresAt` | none, and the manifest says why |
| `objects.completeUpload` | `store?, bucket, key` | `Head`s the object and returns what was stored | `objects.list`, `objects.head` |
| `objects.presign` | `store?, bucket, key, expiresSeconds` | a GET share link, refused with the reason when unavailable | none, and the manifest says why |
| `cas.pin` | `store?, hash` | engine index | `cas.list` |
| `cas.unpin` | `store?, hash` | engine index | `cas.list` |
| `cas.gc` | `store?` | returns `{scanned, deleted, freedBytes}` | `cas.list`, `cas.status` |

Notes that are not obvious from the table:

- `objects.list` defaults `limit` to 100 and clamps to 1000. `delimiter`
  defaults to `/`, and an empty string asks for a flat listing.
  `foldersSupported` is true once every driver reports prefixes, and stays in the response so a
  future driver without them renders honestly.
- `storedSize` is named for what it is. Compress shrinks it, encrypt adds 32
  bytes, and the name keeps that true through any rewrite of the page copy.
- `system.status` computes `applied` for each protection flag from the
  resolver's registrations: encryption is applied when a registration named
  `encrypt` exists, and so on. `configured` comes from config. The note on
  encryption explains that the extension never registers it.
- `etagIsContentHash` is true on S3, GCS and Azure and false on mem, local and
  SFTP.
- `middleware.list` warnings, each emitted only when it applies: compress and
  encrypt both registered (read order), a content-type scope in use (matches
  by extension), any registration at all (CAS, copy and streams bypass it).
- `objects.presign` is available only when the driver implements
  `PresignDriver` and no registration matches the key. On GCS and Azure it
  also needs signing credentials, and the driver's error becomes the reason.
- `cas.list` lists the CAS bucket through the driver and joins each blob to
  `CAS.Stat`. A blob in the bucket with no index entry is `indexed: false`,
  which is how a restart shows up.

### Content routes and tickets

Two routes under `dashboard_content_path`:

- `GET {path}?t=<ticket>`: download or preview.
- `PUT {path}?t=<ticket>`: upload the raw body.

A ticket is `base64url(payload).base64url(hmac)`, where the payload carries
store, bucket, key, operation (`download`, `preview` or `upload`), expiry, the
principal's subject, and for uploads the declared size, content type and
overwrite flag. Download and preview tickets live 60 seconds. Upload tickets
live 15 minutes, because a 64 MiB PUT on a slow link takes a while. The subject
is carried for the log line, not for authorisation. The route authorises by
signature alone, which is what lets a plain `<a download>` work.

GET always answers:

- `Content-Disposition: attachment; filename*=UTF-8''<last key segment>`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: sandbox`
- `Cache-Control: no-store`

It never serves user content inline on the dashboard's origin. An uploaded
HTML or SVG file would otherwise run as the operator. `Content-Length` is set
only when no read middleware matches the key, because the stored size is not
the size of what comes out. A `preview` ticket carries a byte limit, and the
route stops after that many logical bytes, after middleware.

PUT checks the ticket, refuses a body larger than the ticket's declared size,
calls `trove.Put` with the ticket's content type, and answers
`{key, storedSize, etag}`. A scan rejection is 422 with the threat name.

`dashboard_content_secret` empty means a random key per process. That breaks
behind a load balancer, where a ticket minted on one instance is presented to
another, so `system.status` reports `"per-process"` and the Overview page says
what to set.

## The React half

`packages/plugin-trove`, with `extension: "trove"`, `namespace: "trove"`,
label "Storage".

### Information architecture

One nav group, Storage:

| label | path | reads |
|---|---|---|
| Overview | `/` | `system.status`, `stores.list` |
| Buckets | `/buckets` | `buckets.list` |
| (browser) | `/buckets/:bucket` | `objects.list`, `objects.head` |
| Middleware | `/middleware` | `middleware.list` |
| CAS | `/cas` | `cas.status`, `cas.list` |
| Transfers | `/transfers` | `streams.list` |

In multi-store mode a store switcher (kit `scope-switcher`) sits in each page
header and sets the `store` param. In single-store mode it doesn't render. The
browser keeps `prefix` and the selected `key` in the query string, the way
Vault's audit page keeps its filters, so any view can be linked. The plan
confirms `PluginLink` carries a query string and falls back to a splat route
if it doesn't.

### Overview

Driver and health first. Then a capability grid that says what this backend
can and can't do, with the consequence: "Presigned links: not available on
local", "Folders: reported by the driver".

Then Protection, which is the coverage ceiling written as content. Each flag
shows configured against applied. On a deployment with
`enable_encryption: true` it reads "Encryption: configured, not applied.
Nothing is encrypted," followed by why. Compression and scanning get the same
treatment from the resolver.

Then a read-only config block, which is where the templ Settings page went.
The storage DSN is not shown, because it can carry credentials; the driver
name is.

No object counts and no storage used. No driver can produce either.

### Buckets

`ResourceTable`: name in `font-medium`, then a date column whose header follows
`createdAtMeaning`, "Created" or "Last modified". A create dialog. A delete
`ConfirmDialog` that says up front it refuses a bucket that still holds
objects. A row opens the browser.

### The browser

A lazy route. Layout:

```
┌ Storage / Buckets / reports ──────────────────────── [Upload files] ┐
│  reports / 2026 / 09 / ▏filter this prefix…                         │
├──────────────────────────────────────────┬──────────────────────────┤
│ Name               Stored size   Modified │ 2026/09/summary.json     │
│ ▸ daily/                                  │ Stored size   4,812 B    │
│ ▸ weekly/                                 │ ETag          9f3a01…    │
│   summary.json       4,812 B    2 min ago │ Content type  app/json   │
│   raw.bin               none    …         │ Metadata      owner=ops  │
│                                           │ Applies now   compress   │
│ 214 shown, more under this prefix [More]  │ ┌ preview ─────────────┐ │
│ ─ ─ ─ drop files to upload to 2026/09/ ─ ─│ │ { "total": …         │ │
│  ▓▓▓▓▓▓░░ q3.csv  61%   ✕                  │ └──────────────────────┘ │
│                                           │ Download  Copy key  Share│
└──────────────────────────────────────────┴──────────────────────────┘
```

The path bar is the one distinctive element. It renders the current prefix as
the literal key, in `font-mono text-xs`, each segment a link back up, with the
tail as an input so typing continues the prefix. It never draws a directory
tree. Folder rows appear only because the driver returned common prefixes.

The listing:

- Caption with a live count and never a total: "214 shown, more under this
  prefix" or "12 objects, 3 folders".
- Three empty states: the bucket is empty; nothing under this prefix; nothing
  on this page but the driver has more to list, with Load more. The third is
  real with delimiter listing, where a page can hold only folded keys.
- Rows virtualise with `@tanstack/react-virtual` once Load more has
  accumulated more than about 200.
- Absent values render with `NoneCell`. Keys, ETags, hashes and byte sizes are
  `font-mono text-xs`.

The inspector sits in a kit `resizable` panel and renders `objects.head`:
stored size, ETag, content type, storage class, version id, user metadata, and
"Applies now" listing the matching middleware. That label is current config,
worded as such, never history. Preview:

- Text, JSON and anything `text/*`: a read-only CodeMirror 6 view, lazy loaded,
  reusing the `@codemirror/*` versions relay and chronicle already pin. Capped
  at 256 KiB through a preview ticket.
- `image/*`: fetched through a preview ticket into a Blob, shown with an
  object URL in an `<img>`, which cannot run SVG script.
- Anything else: "No preview for this content type."

Actions: Download, Copy key, Share link (only when `presign.available`, and the
reason otherwise), Copy to (a dialog), Delete (a `ConfirmDialog` that states
the CAS-bucket refusal when it applies).

Uploads:

- The whole listing is the drop target. The overlay names the destination
  prefix in mono. Native `DataTransfer.files`, no react-dropzone.
- Each file: `objects.beginUpload`, then an XHR PUT for real progress events,
  then `objects.completeUpload`, whose `invalidates` refreshes the listing.
- A tray under the listing shows each file's progress (kit `Progress`) with
  cancel. A `CONFLICT` from begin asks whether to overwrite. Every failure
  stays on its own row.
- Dropped folders are refused with a line saying to drop the files.

### Middleware

The registrations table: name, direction, scope, priority. A "Test a key" form
takes a bucket and key and shows the write and read pipelines that would apply,
in the order they run. Warnings render as kit `Alert`s.

### CAS

A status block that states the ceiling: the index is in memory and resets on
restart, and nothing can release content, so GC has nothing to collect. Then
the entries table from `cas.list`: hash in mono, stored size, refs, state. Pin
and Unpin per row. Run GC behind a `ConfirmDialog` that reports the real
result. Lookup by hash.

If CAS is disabled the page says so and renders nothing else.

### Transfers

`streams.list`, with the header copy: "Streams open in this process. They are
not saved and are lost on restart." Columns: direction, bucket and key, state,
offset against total size. Empty: "No streams open."

### Badges

Proportion first, per the playbook.

| surface | outline | secondary | default | destructive |
|---|---|---|---|---|
| protection flags | applied | not configured | | configured, not applied |
| CAS entries | indexed with refs | pinned | refs 0, unpinned | not indexed |
| stream states | active | idle, paused | completing, completed | failed, cancelled |
| health | healthy | | | unhealthy |

A stream stays in the pool until its owner calls `Release`, so completed
streams can render; they are not what you came for. On CAS, indexed with
refs is the majority in any running process, and a blob that lost its index
entry is what you came to find.

### Lazy loading and dependencies

- The browser route is lazy. Its chunk carries the virtualiser, the upload
  tray and the inspector.
- CodeMirror is a second lazy boundary inside the inspector, loaded the first
  time a text preview renders.
- New dependencies: `@codemirror/{state,view,language,lang-json,search,commands}`
  at relay's versions, and `@tanstack/react-virtual` at kit's `^3.14.11`. No
  upload library, no image library.
- Re-measure with `pnpm build` and write the numbers into `BASELINE.md`, and
  check the chunks actually split.

### Wiring

`apps/shell`: add the plugin to `package.json` and `App.tsx`. `apps/example-next`:
add it to `forge.config.ts`. Content routes do not work behind the Next proxy,
which reads bodies as text with a 1 MiB cap. That is `packages/next`'s to fix,
and it goes in `MIGRATION.md` as a known gap.

## Fixtures

`packages/fixture-server/trove-fixtures.mjs`, imported by `server.mjs` into
`CONTRIBUTORS`, with inputs in `verify.mjs`. It models the fixed contract, not
today's drivers: paging that works, folders from prefixes, a non-empty bucket
delete refused, a CAS delete refused, one blob not indexed, a protection flag
configured and not applied. Writes change the next read.

`server.mjs` also gets trove-only content routes at the fixture's content
path: GET and PUT against the fixture's in-memory objects, honouring tickets,
headers and the size cap. That is the one departure from contributor-only
edits, agreed in conversation.

## Sequencing

Five slices, each with its own plan.

1. **Trove core.** Driver prefixes and cursors, CAS and stream accessors,
   `trovetest` cases.
2. **Contract.** The 20 intents, tickets, content routes, config keys,
   registration, and Go tests.
3. **Plugin read surfaces and fixtures.** Overview, Buckets, Middleware, CAS,
   Transfers, the fixture file, and shell wiring.
4. **The browser.** Listing, inspector, preview, upload and download, the
   fixture content routes, `BASELINE.md`.
5. **Retire templ.** `MIGRATION.md`, then the deletion commit.

Slice 5 starts only after slices 3 and 4 are clicked through in a browser
against the fixture server.

## Retiring the templ dashboard

In the playbook's order:

1. Write the feature inventory into `trove/MIGRATION.md` while the pages still
   exist: every page, column, action, filter, badge, empty state and widget,
   each marked migrated, replaced, or dropped with a reason.
2. Check importers. The only importer of `trove/extension/dashboard` is
   `extension/extension.go`; nothing else in forgery imports it.
3. Delete, as its own commit: `extension/dashboard/` entire, every
   `*_templ.go`, `DashboardContributor()`, the `trovedash` import and the
   `DashboardAware` assertion. Run `go mod tidy`.
4. Prove it: `find . -name '*.templ'` returns nothing; `go build ./...` and
   `go test ./...` pass in both modules; `golangci-lint` passes on a fresh
   cache.

Templ stays in the extension's module graph as an indirect dependency after
the deletion. forge's `dashboard/contract` imports `dashboard/auth`, which
imports templ, in every released forge tag. forge main has removed it and is
unreleased. `MIGRATION.md` says this, and bumping forge once a release exists
finishes the job. `forgeui` should drop out of `go.mod` entirely; if `go mod
tidy` keeps it, find out what still pulls it before calling the cut-off done.

Planned accounting for the templ items, to be expanded in `MIGRATION.md`:

| templ item | outcome |
|---|---|
| Overview stat cards (buckets, objects, storage used, active uploads) | dropped: counts are capped at 100 per bucket and read an unwritten table; no driver can count |
| Recent objects card and widget | dropped: reads an unwritten table; no driver lists by recency |
| Quick actions | replaced by nav |
| Buckets list and create form | migrated, reading the driver; region, quota, versioning and CAS fields dropped as stored labels nothing enforces |
| Bucket search box | dropped: the handler never read it |
| Bucket detail, edit, lifecycle JSON | dropped: metadata-store only, never sent to a driver; no driver implements lifecycle |
| Bucket delete | replaced: deletes the driver bucket, refused when not empty |
| Objects list and prefix filter | replaced by the browser |
| Object detail fields | migrated from `Head`; checksum and tags dropped (no driver stores tags; checksums were never written) |
| Object metadata and tag editing | dropped: metadata-store only, and metadata save wiped everything |
| Object copy | migrated, with the middleware guard |
| Object delete | replaced: deletes the bytes, not a soft-delete row |
| Download link | replaced by ticketed download |
| Generate URL | replaced by Share link |
| File browser, upload drop zone | replaced by the browser |
| New folder | dropped: it had no handler, and a folder is a prefix |
| Uploads list, filter, detail, abort | dropped: nothing writes upload sessions; replaced by Transfers |
| CAS index table, filters | replaced by `cas.list` from the engine and bucket |
| CAS pin and unpin | migrated to the engine index |
| CAS GC | migrated, with the ceiling stated |
| Quotas page | dropped: not enforced, usage never measured, create broken on SQL |
| Settings page | replaced by Overview's config block and Protection section |
| Health widget | replaced by Overview |
| Stats widget | dropped with the stat cards |
| Topbar search, API docs link | dropped: no search provider existed; docs link is not a dashboard feature |
| Plugin section interfaces | dropped: no implementers anywhere in forgery |

## Testing

Go, per the playbook's "your dashboard inherits the extension's correctness":

- Contract handlers run against memdriver and localdriver on real temp files.
  Those are the backends CI can run.
- Store isolation: write in store A, list store B, assert on identity.
- An unknown store is `NOT_FOUND`, with a test for each of: empty string,
  unknown name, default name in single-store mode.
- Tickets: expired, tampered payload, tampered signature, wrong operation,
  upload over the declared size.
- Content route: the four response headers, the size cap, overwrite
  `CONFLICT`, and a round trip with compress registered where the stored bytes
  differ from the upload and the downloaded bytes match it.
- `buckets.delete` refuses non-empty on both backends, and on localdriver the
  files are still there afterwards.
- `objects.copy` refuses across differing middleware.
- `transport_test.go` proves `meta.invalidates` reaches the client; a manifest
  test checks every command's invalidates.
- trovetest cases for delimiter and paging, in CI on mem and local.

What the Go tests do not cover, stated in `MIGRATION.md`: the S3, GCS, Azure
and SFTP changes compile and are exercised only under the `integration` tag,
which CI does not run.

React: vitest per page on Vault's stub-client harness, a fake XHR for the
upload tray, a lazy-route guard test, and `test`, `typecheck` and `lint` in the
package plus `pnpm -r test`. Then the fixture server and the shell, clicked
through, with screenshots.

## Findings for MIGRATION.md

Recorded, not fixed here, and raised with you:

- `EnableEncryption` is display-only in both modes; per-store `enableEncrypt`
  is collected and ignored. The Vault key-provider hook exists and nothing
  constructs it.
- The read pipeline is not reversed, so compress plus encrypt returns
  compressed bytes without error. The docs say the opposite and give a default
  priority of 100 that the code does not use.
- `ScopeContentType` matches key extensions, and only `x/*` entries.
- The resolver's cache ignores `ctx`, and a stale entry can keep an old
  pipeline for one direction after `Register` or `Remove`.
- compress silently decompresses user-uploaded zstd on download.
- encrypt has no default key provider and panics without one; plaintext read
  through it fails or panics.
- Every middleware buffers whole objects in memory.
- The REST handler's `Content-Length` is the stored size, wrong under
  compress, encrypt or watermark.
- CAS: in-memory index lost on restart, no release API, GC can never collect,
  the `cas` bucket is never created, CAS bypasses middleware.
- Streams: `Drop` backpressure discards upload data, `MaxBandwidth` and
  `IdleTimeout` are inert, `Stream.Close` leaks the pool slot.
- Multipart: GCS parts are visible objects not namespaced per upload, upload
  ids repeat after restart, state is lost on restart; Azure abort does nothing
  on the backend and block ids collide across uploads.
- ETags: mem is length only; local, SFTP and Azure `Put` return a different
  ETag from `Head`.
- Azure `Put` echoes a storage class it never applied; `CreatedAt` is really
  last-modified on Azure, local and SFTP.
- Unclassified errors: GCS bucket exists, S3 and GCS bucket not empty, most
  GCS and Azure multipart errors.
- `DeleteBucket` is recursive on four drivers and refused on two.
- VFS: `ReadDir` sees at most 1000 keys, `RemoveAll` deletes one page,
  `Mkdir` on local stores the marker as a plain file, `SetMetadata` is a
  no-op on S3, GCS and Azure, IOFS `ReadDir(n)` returns the wrong error.
- Copy: S3 does not URL-encode `CopySource`; Azure's copy is asynchronous and
  never polled; S3, GCS and Azure ignore `CopyOption`.
- The metadata store: no writers for objects, uploads, CAS or quota usage;
  broken upserts on SQL; not-found sentinels differ by backend; quota save
  zeroes usage; no tests on any backend; the memory store and `migrate`
  package are imported nowhere.
- All five hooks (chronicle, dispatch, metrics, vault, warden) are never
  constructed; the warden hook trusts a client-supplied `X-Subject-ID`.
- The handler package is never mounted and has no auth.
- The conformance suite runs on mem and local only, and the integration setups
  likely cannot pass as written.
- Next.js proxy cannot carry content routes.
