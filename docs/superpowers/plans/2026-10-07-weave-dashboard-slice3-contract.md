# Weave dashboard, slice 3: the contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every trace of templ from Weave (record the old dashboard in `MIGRATION.md`, delete `dashboard/`, move to forge v1.12.0 so templ and forgeui leave the module graph), then give Weave a `weave` contract contributor that answers the 17 intents the React dashboard reads and writes, register it from the Forge extension, and pass the extension's YAML config to the engine.

**Architecture:** A new package `extension/contract` holds an embedded `manifest.yaml`, one `Register` function, and one handler file per area (system, collections, documents, chunks, retrieval). Every handler calls engine methods only, never the store, so the dashboard and Weave's HTTP API share every fix. The extension implements `ContractContributorAware` by calling `contract.Register`; nothing in production code imports forge's root `extensions/dashboard` package.

**Tech Stack:** Go 1.26, forge v1.12.0 (`extensions/dashboard/contract`, `.../dispatcher`, `.../loader`, `.../transport` in tests), grove v1.7.0, the slice 1 engine.

**Spec:** `docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md` in the forge-dashboard repo. Read "The contract package", "The 17 intents" table, "Retrieval", and the whole of "What slice 1 found that slice 2 must know" before Task 2.

## Global Constraints

- Repo `/Users/rexraphael/Work/xraph/forgery/weave`, branch `main`, no worktrees. Shared checkout: `git add <exact files>` then `git commit --only -m "..." -- <exact paths>`, then `git show --stat HEAD`. Never `add -A`, `add .`, a directory, `--amend`, `stash`, `reset`, `restore`, `clean`, `checkout`, `switch`, `push`. `_project_files/` and `.superpowers/` are not yours.
- Commit messages: conventional prefix, plain English, no em or en dashes, NO `Co-Authored-By`, no AI attribution.
- Rex's instruction (2026-10-07): all templ goes in this slice. The templ `dashboard/` is already dead code (xraph/weave#39 unwired it), so deleting it loses nothing at runtime. Order: write `MIGRATION.md` while the pages exist, delete `dashboard/` as its own commit, then move to forge v1.12.0 (which removed `extensions/dashboard/contributor` and no longer pulls templ or forgeui through `dashboard/auth`). After Task 2, `find . -name '*.templ' -not -path './_*'` is empty and `go.mod`/`go.sum` contain no `a-h/templ`, `xraph/forgeui` or `tailwind-merge-go`.
- `go mod tidy` is run once, in Task 2, and its whole result is committed: with templ gone it is the tool that removes templ, forgeui and the requirements only they and older forge versions needed. The commit body lists every module it removed.
- Production code never imports `github.com/xraph/forge/extensions/dashboard` (the root package): its `auth` subpackage pulls in templ. Import only `.../dashboard/contract` and `.../dashboard/contract/dispatcher` (and `.../loader`). The `ContractContributorAware` assertion lives in a `_test.go` file.
- The contributor name, the extension name and the plugin's `extension` are all `weave`.
- Wire field names are snake_case, copied from Weave's own JSON tags. Request and response types defined here use snake_case too.
- Paging is `limit` and `offset` in, `items` and `total` out, on every list. Default limit 25, maximum 100 (larger is clamped). A negative `limit` or `offset` is `BAD_REQUEST`.
- Every list takes an optional `tenant` (`*string`): absent means every tenant, present is an exact match, `""` included. The dashboard is operator-wide; the manifest says so.
- No response ever carries a vector or an embedding.
- Errors: not found is `NOT_FOUND`; a bad or missing argument, an unparseable ID, the 1 MiB ingest cap, overlap at or above size are `BAD_REQUEST`; a duplicate document or collection name is `CONFLICT`; a missing embedder, vector store, chunker or store is `UNAVAILABLE` naming what is missing; anything else is `INTERNAL` with a generic message, logged with the intent name. Nothing is swallowed.
- Every command declares `invalidates`, exactly as the spec's intent table lists.
- No new third-party test libraries.
- Lint with a fresh cache: `C=$(mktemp -d); GOLANGCI_LINT_CACHE=$C golangci-lint run ./...; rm -rf $C`.

## Review Focus

1. A failed ingest (the embedder errors after the document row exists) must answer `state: failed` with the stored error, never a contract error that hides the document; a duplicate must answer `CONFLICT`. Pinned in Task 6.
2. An unparseable ID must be `BAD_REQUEST` and a well-formed ID that does not exist must be `NOT_FOUND`, on every by-ID intent, never `INTERNAL`. Pinned in Tasks 5, 6, 7.
3. `tenant: ""` through the contract must reach the engine as an exact filter (only untenanted rows), and an absent `tenant` must mean every tenant. Pinned in Task 5 (lists) and Task 8 (retrieval).
4. An unrecognised internal error must never reach the client with its text (it can carry a DSN or a host). Pinned in Task 3.
5. Retrieval on a deployment with no embedder or vector store must answer `UNAVAILABLE` saying so, not `INTERNAL`. Pinned in Task 8.

---

### Task 1: Record the templ dashboard, then delete it

**Files:**
- Create: `MIGRATION.md`
- Delete: `dashboard/` (27 `.templ` files, 27 generated `*_templ.go`, `contributor.go`, `data.go`, `manifest.go`, `plugin_iface.go`, `forge.contributor.yaml`, `shared/`, and everything else under it)

Follow `packages/plugin/PLAYBOOK.md` "Retiring the templ dashboard" in the forge-dashboard repo, steps 1 to 5, in order: the inventory has to be written while the sources still exist.

- [ ] **Step 1: Walk every templ source and write the inventory**

Read every file under `dashboard/` (pages, components, widgets, settings, shared, `contributor.go`, `data.go`, `manifest.go`, `plugin_iface.go`, `forge.contributor.yaml`). A checklist compiled from the same sources on 2026-10-07 is in the spec's "What the 12 templ pages show" section and in the plan-writer's notes; use them to check you missed nothing, never instead of reading the sources.

Invoke the `rex-voice` skill, then write `MIGRATION.md` at the repo root, then run it through `humanizer` in embedded mode. No em or en dashes. Shape it like `forgery/trove/MIGRATION.md` (read that first). It must contain:

- an opening that says what moved where: Weave's dashboard now lives in the Forge dashboard's React shell as `@forge-go/dashboard-plugin-weave`, reading the `weave` contract contributor in `extension/contract`, and the templ package is gone; that xraph/weave#39 stopped registering it and this commit set deletes it;
- "What you need to do": nothing changes in Weave's own API; `Extension.DashboardContributor()` is gone (removed in #39); an import of `github.com/xraph/weave/dashboard` must go; Weave needs forge v1.12.0; add the plugin to the shell;
- the full inventory, one section per page (Overview, Collections, Collection detail, Collection form, Documents, Document detail, Chunks, Chunk detail, Retrieval, Pipeline, Loaders, Extensions), plus Widgets, Settings, the plugin hooks in `plugin_iface.go`, the nav and topbar from `manifest.go` and `forge.contributor.yaml`: every column, stat, action, filter, form field, badge, empty state and nav item;
- for EVERY item, its fate: **moved** (to which React page or contract intent in the spec), **changed** (how and why), or **dropped** (with the reason). Reasons the spec already gives: the three widgets (Overview covers them; plugins have no widget slot), the settings panel (a read-only copy of Pipeline config), the five templ plugin hooks (nothing implements them, each returns `templ.Component`), the "searchable" capability (declared, never implemented), the hard-coded Loaders list (replaced by content types probed from each loader's `Supports`), the strategy select on retrieval (the engine ignores it), the per-stage "Active" badges (always Active regardless);
- the templ dashboard's own defects, so nobody mistakes them for features: create, edit and delete called routes that do not exist; the delete dialog's success handler throws; "recent" lists showed the oldest rows; Postgres state counts were always 0; collection doc and chunk counts were always 0; retrieval results never linked to a chunk or document; errors were swallowed everywhere;
- a "Still open" list: pgvector paths untested (no vector extension in the test image), Fabriq's tie order and tenant filter unverified, the pipeline package omits `tenant_id` for untenanted rows, the strategy parameter is still ignored, reindex re-embeds and never re-chunks, source text is not stored, an overlap of 0 cannot be set (the engine reads 0 as the default);
- a note that the React pages are being built (slices 2 and 4 of the migration) and this file's "moved" entries name what they will show; slice 5 confirms each one after the browser walk.

- [ ] **Step 2: Find everything that imports the dashboard package**

```bash
grep -rn '"github.com/xraph/weave/dashboard' --include='*.go' . | grep -v '^./dashboard/'
```

Expected: no output (#39 removed the only importer). If anything prints, stop and report it.

- [ ] **Step 3: Commit the inventory alone**

```bash
git add MIGRATION.md
git commit --only -m "docs: record what the templ dashboard did before it goes" -- MIGRATION.md
git show --stat HEAD
```

- [ ] **Step 4: Delete the directory and prove it**

```bash
git rm -r -q dashboard
find . -name '*.templ' -not -path './_*'
go build ./... && go vet ./... && go test -count=1 ./...
```

Expected: `find` prints nothing; build, vet and tests pass (forge is still v1.10.0 here, which is fine: nothing outside `dashboard/` used the removed packages).

`git rm -r dashboard` stages exactly the tracked files under that path and nothing else; confirm with `git status --short` that every staged line starts with `D  dashboard/` before committing.

- [ ] **Step 5: Commit the deletion as its own commit**

```bash
git commit --only -m "chore: delete the templ dashboard" -- dashboard
git show --stat HEAD | tail -3
```

Expected: only deletions under `dashboard/`.

---

### Task 2: Move to forge v1.12.0 and grove v1.7.0, and drop templ and forgeui

**Files:**
- Modify: `go.mod`, `go.sum`

Proven on a scratch copy of 0d29d1b with `dashboard/` deleted: the bump plus `go mod tidy` removes `github.com/a-h/templ`, `github.com/xraph/forgeui`, `github.com/Oudwins/tailwind-merge-go` and `nhooyr.io/websocket`, and the stale OpenTelemetry exporter, gRPC, genproto, zap and multierr requirements; `go build`, `go vet` and `go test ./...` pass.

- [ ] **Step 1: Bump and tidy**

```bash
go get github.com/xraph/forge@v1.12.0 github.com/xraph/grove@v1.7.0 github.com/xraph/grove/drivers/pgdriver@v1.7.0 github.com/xraph/grove/drivers/sqlitedriver@v1.7.0 github.com/xraph/grove/drivers/mongodriver@v1.7.0
go mod tidy
```

- [ ] **Step 2: Prove templ and forgeui are gone**

```bash
grep -nE 'a-h/templ|xraph/forgeui|tailwind-merge-go' go.mod go.sum
find . -name '*.templ' -not -path './_*'
find . -name '*_templ.go' -not -path './_*'
```

Expected: all three print nothing. Then `git diff go.mod` and write down every module removed or moved, for the commit body.

- [ ] **Step 3: Gate**

With the test databases running and both DSNs exported: `go build ./... && go vet ./... && go test -count=1 ./...`.
Expected: all `ok`, store conformance 0 SKIP.

- [ ] **Step 4: Commit**

The message body lists what tidy removed (one module per line, no dashes as punctuation):

```bash
git commit --only -F - -- go.mod go.sum <<'MSG'
chore(deps): move to forge v1.12.0 and drop templ and forgeui

forge v1.12.0 no longer pulls templ or forgeui through its dashboard
packages, and the templ dashboard is gone, so neither is in the module
graph any more. Tidy also removed requirements only they and older
forge releases needed:

<one removed module per line, copied from git diff go.mod>
MSG
git show --stat HEAD
```

---

### Task 3: The contract's foundation

**Files:**
- Create: `extension/contract/manifest.yaml`
- Create: `extension/contract/contract.go`
- Create: `extension/contract/errors.go`
- Create: `extension/contract/paging.go`
- Create: `extension/contract/helpers_test.go`
- Create: `extension/contract/manifest_test.go`
- Create: `extension/contract/errors_test.go`
- Create: `extension/contract/paging_test.go`

**Interfaces:**
- Produces: `ContributorName = "weave"`, `StalledAfter = 15 * time.Minute`, `type Deps struct{ Engine *engine.Engine; Logger forge.Logger; Now func() time.Time }`, `(Deps).now() time.Time`, `(Deps).mapError(intent string, err error) error`, `func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error`, `func bindings(deps Deps) []binding`, `query(...)`, `command(...)`.
- Produces in errors.go: `mapError(err error) error`, `badRequest(msg string) error`, `notFound(msg string) error`, `conflict(msg string) error`, `unavailable(msg string) error`, `parseCollectionID(field, s string) (id.CollectionID, error)`, `parseDocumentID(field, s string) (id.DocumentID, error)`, `parseChunkID(field, s string) (id.ChunkID, error)`, `optionalCollectionID(field, s string) (id.CollectionID, error)`, `optionalDocumentID(field, s string) (id.DocumentID, error)`.
- Produces in paging.go: `type page struct{ Limit int "limit"; Offset int "offset" }`, `(page).resolve() (limit, offset int, err error)`, `type listOutput[T any] struct{ Items []T "items"; Total int64 "total"; Limit int "limit"; Offset int "offset" }`, `emptyIfNil(m map[string]string) map[string]string`.
- Produces in helpers_test.go (package `contract`): `hashEmbedder`, `failingEmbedder`, `openMemory(t) store.Store`, `openSQLite(t) store.Store`, `newDeps(t, s store.Store, opts ...engine.Option) Deps`, `forEachStore(t, fn func(t *testing.T, deps Deps))`, `codeOf(err) contract.ErrorCode`, `principal() contract.Principal`, `mustCollection(t, deps, name) *collection.Collection`, `mustIngest(t, ctx, deps, colID, title, content) id.DocumentID`.

- [ ] **Step 1: Write the manifest**

`extension/contract/manifest.yaml`:

```yaml
schemaVersion: 1
contributor:
  name: weave
  envelope:
    supports: [v1]
    preferred: v1
  capabilities: [weave.read, weave.write]

# Weave resolves no tenant on the dashboard path, so this dashboard is
# operator-wide: it sees every tenant's data. Every list and retrieval
# intent takes an optional `tenant`. Absent means every tenant; present is
# an exact match, and "" means rows written with no tenant.
#
# retrieval.run is a command although it writes nothing: every run calls
# the embedder, usually a paid API, and a query could be cached and
# refetched. A command fires only when somebody presses Run.
intents:
  - { name: system.overview,    kind: query, version: 1, capability: read }
  - { name: system.components,  kind: query, version: 1, capability: read }
  - { name: collections.list,   kind: query, version: 1, capability: read }
  - { name: collections.get,    kind: query, version: 1, capability: read }
  - { name: documents.list,     kind: query, version: 1, capability: read }
  - { name: documents.get,      kind: query, version: 1, capability: read }
  - { name: documents.spans,    kind: query, version: 1, capability: read }
  - { name: chunks.list,        kind: query, version: 1, capability: read }
  - { name: chunks.get,         kind: query, version: 1, capability: read }
  - { name: collections.create,  kind: command, version: 1, capability: write, invalidates: [collections.list, system.overview] }
  - { name: collections.update,  kind: command, version: 1, capability: write, invalidates: [collections.list, collections.get] }
  - { name: collections.delete,  kind: command, version: 1, capability: write, invalidates: [collections.list, collections.get, documents.list, chunks.list, system.overview] }
  - { name: collections.reindex, kind: command, version: 1, capability: write, invalidates: [collections.get, system.overview] }
  - { name: documents.ingest,    kind: command, version: 1, capability: write, invalidates: [documents.list, chunks.list, collections.list, collections.get, system.overview] }
  - { name: documents.delete,    kind: command, version: 1, capability: write, invalidates: [documents.list, documents.get, chunks.list, collections.list, collections.get, system.overview] }
  # retrieval.run and retrieval.assemble write nothing.
  - { name: retrieval.run,       kind: command, version: 1, capability: write }
  - { name: retrieval.assemble,  kind: command, version: 1, capability: write }
```

- [ ] **Step 2: Write the failing manifest tests**

`extension/contract/manifest_test.go`:

```go
package contract

import (
	"bytes"
	"reflect"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"
)

func loadManifest(t *testing.T) *dashcontract.ContractManifest {
	t.Helper()
	m, err := loader.Load(bytes.NewReader(manifestYAML), "weave/contract/manifest.yaml")
	if err != nil {
		t.Fatalf("load manifest: %v", err)
	}
	return m
}

func TestManifest_Loads(t *testing.T) {
	m := loadManifest(t)
	if m.Contributor.Name != ContributorName {
		t.Errorf("contributor = %q, want %q", m.Contributor.Name, ContributorName)
	}
	if got := len(m.Intents); got != 17 {
		t.Errorf("intents = %d, want 17", got)
	}
}

// The React client refreshes through invalidates and nothing else, so each
// command's list is pinned exactly as the spec's intent table gives it.
func TestManifest_CommandInvalidates(t *testing.T) {
	want := map[string][]string{
		"collections.create":  {"collections.list", "system.overview"},
		"collections.update":  {"collections.list", "collections.get"},
		"collections.delete":  {"collections.list", "collections.get", "documents.list", "chunks.list", "system.overview"},
		"collections.reindex": {"collections.get", "system.overview"},
		"documents.ingest":    {"documents.list", "chunks.list", "collections.list", "collections.get", "system.overview"},
		"documents.delete":    {"documents.list", "documents.get", "chunks.list", "collections.list", "collections.get", "system.overview"},
		"retrieval.run":       nil,
		"retrieval.assemble":  nil,
	}
	seen := 0
	for _, in := range loadManifest(t).Intents {
		if in.Kind != dashcontract.IntentKindCommand {
			if len(in.Invalidates) != 0 {
				t.Errorf("query %s declares invalidates %v", in.Name, in.Invalidates)
			}
			continue
		}
		w, ok := want[in.Name]
		if !ok {
			t.Errorf("unexpected command %s", in.Name)
			continue
		}
		seen++
		if len(w) == 0 && len(in.Invalidates) == 0 {
			continue
		}
		if !reflect.DeepEqual(in.Invalidates, w) {
			t.Errorf("%s invalidates = %v, want %v", in.Name, in.Invalidates, w)
		}
	}
	if seen != len(want) {
		t.Errorf("found %d of %d commands", seen, len(want))
	}
}
```

Run: `go test ./extension/contract/ -run TestManifest`
Expected: FAIL to compile, `undefined: manifestYAML`.

- [ ] **Step 3: Write contract.go**

```go
// Package contract wires Weave into the Forge dashboard's contract path. It
// registers the `weave` contributor and answers its intents from the Weave
// engine. Handlers call engine methods only, never the store, so a fix in
// the engine reaches the dashboard and Weave's HTTP API alike.
package contract

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"time"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/loader"

	"github.com/xraph/weave/engine"
)

//go:embed manifest.yaml
var manifestYAML []byte

// ContributorName is the join key with packages/plugin-weave's `extension`
// field and matches the extension's name. A mismatch hides the React
// plugin with no error anywhere.
const ContributorName = "weave"

// StalledAfter is how long a document may sit in processing before the
// dashboard flags it. Ingest runs inside one request and Weave has no
// heartbeat, so a document still processing this long after its last
// update almost certainly died with its process.
const StalledAfter = 15 * time.Minute

// Deps bundles what the handlers need.
type Deps struct {
	// Engine answers every intent. Required.
	Engine *engine.Engine

	// Logger receives an Error entry for every error mapped to
	// CodeInternal. Optional.
	Logger forge.Logger

	// Now is the clock the stalled check reads. Optional; nil means
	// time.Now.
	Now func() time.Time
}

func (d Deps) now() time.Time {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now()
}

// binding registers one intent with the dispatcher.
type binding struct {
	intent string
	bind   func(d *dispatcher.Dispatcher) error
}

func query[I, O any](intent string, fn func(context.Context, I, contract.Principal) (O, error)) binding {
	return binding{intent: intent, bind: func(d *dispatcher.Dispatcher) error {
		return dispatcher.RegisterQuery(d, ContributorName, intent, 1, fn)
	}}
}

func command[I, O any](intent string, fn func(context.Context, I, contract.Principal) (O, error)) binding {
	return binding{intent: intent, bind: func(d *dispatcher.Dispatcher) error {
		return dispatcher.RegisterCommand(d, ContributorName, intent, 1, fn)
	}}
}

// bindings lists every intent this package answers. Tasks 4 to 8 add to it.
func bindings(deps Deps) []binding {
	return []binding{}
}

// Register loads and validates the embedded manifest, registers the
// `weave` contributor with reg, and binds every handler. A handler bound
// to an intent the manifest does not declare is a build mistake and fails
// here rather than at the first request.
func Register(d *dispatcher.Dispatcher, reg contract.Registry, wreg contract.WardenRegistry, deps Deps) error {
	if deps.Engine == nil {
		return fmt.Errorf("weave/contract: Engine is required")
	}
	m, err := loader.Load(bytes.NewReader(manifestYAML), "weave/contract/manifest.yaml")
	if err != nil {
		return fmt.Errorf("weave/contract: load manifest: %w", err)
	}
	if err := loader.Validate(m, wreg); err != nil {
		return fmt.Errorf("weave/contract: validate manifest: %w", err)
	}
	if err := reg.Register(m); err != nil {
		return fmt.Errorf("weave/contract: register manifest: %w", err)
	}
	declared := make(map[string]bool, len(m.Intents))
	for _, in := range m.Intents {
		declared[in.Name] = true
	}
	for _, b := range bindings(deps) {
		if !declared[b.intent] {
			return fmt.Errorf("weave/contract: %s is bound but the manifest does not declare it", b.intent)
		}
		if err := b.bind(d); err != nil {
			return fmt.Errorf("weave/contract: register %s: %w", b.intent, err)
		}
	}
	return nil
}
```

Run: `go test ./extension/contract/ -run TestManifest -v`
Expected: both PASS. (If `loader.Validate` rejects the manifest, the message names the field; fix the YAML, not the test.)

- [ ] **Step 4: Write the failing error and paging tests**

`extension/contract/errors_test.go`:

```go
package contract

import (
	"context"
	"errors"
	"fmt"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave"
	"github.com/xraph/weave/id"
)

func TestMapError(t *testing.T) {
	cases := []struct {
		err  error
		code dashcontract.ErrorCode
	}{
		{weave.ErrCollectionNotFound, dashcontract.CodeNotFound},
		{fmt.Errorf("wrapped: %w", weave.ErrDocumentNotFound), dashcontract.CodeNotFound},
		{weave.ErrChunkNotFound, dashcontract.CodeNotFound},
		{weave.ErrDuplicateDocument, dashcontract.CodeConflict},
		{weave.ErrCollectionAlreadyExists, dashcontract.CodeConflict},
		{weave.ErrEmptyContent, dashcontract.CodeBadRequest},
		{fmt.Errorf("%w: list chunks needs a document or a collection", weave.ErrInvalidArgument), dashcontract.CodeBadRequest},
		{weave.ErrNoEmbedder, dashcontract.CodeUnavailable},
		{weave.ErrNoVectorStore, dashcontract.CodeUnavailable},
		{weave.ErrNoChunker, dashcontract.CodeUnavailable},
		{weave.ErrNoStore, dashcontract.CodeUnavailable},
		{context.Canceled, dashcontract.CodeUnavailable},
		{errors.New("dial tcp 10.0.0.7:5432: connection refused user=weave password=hunter2"), dashcontract.CodeInternal},
	}
	for _, tc := range cases {
		if got := codeOf(mapError(tc.err)); got != tc.code {
			t.Errorf("mapError(%v) = %s, want %s", tc.err, got, tc.code)
		}
	}
}

// An unrecognised error's text can carry a DSN, a host or a credential, so
// it never reaches the client.
func TestMapError_InternalHidesTheCause(t *testing.T) {
	var ce *dashcontract.Error
	if !errors.As(mapError(errors.New("password=hunter2")), &ce) {
		t.Fatal("not a contract error")
	}
	if ce.Message != "an internal error occurred" {
		t.Errorf("message = %q", ce.Message)
	}
}

func TestMapError_InvalidArgumentKeepsItsReason(t *testing.T) {
	var ce *dashcontract.Error
	errors.As(mapError(fmt.Errorf("%w: collection name cannot be blank", weave.ErrInvalidArgument)), &ce)
	if ce == nil || ce.Message != "collection name cannot be blank" {
		t.Errorf("got %+v", ce)
	}
}

func TestParseIDs(t *testing.T) {
	if _, err := parseCollectionID("id", ""); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("empty: %v", err)
	}
	if _, err := parseCollectionID("id", "not-an-id"); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("garbage: %v", err)
	}
	if _, err := parseCollectionID("id", id.NewDocumentID().String()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("wrong prefix: %v", err)
	}
	good := id.NewCollectionID()
	got, err := parseCollectionID("id", good.String())
	if err != nil || got.String() != good.String() {
		t.Errorf("good: %v %v", got, err)
	}
	if got, err := optionalCollectionID("collection_id", ""); err != nil || !got.IsNil() {
		t.Errorf("optional empty: %v %v", got, err)
	}
}
```

`extension/contract/paging_test.go`:

```go
package contract

import (
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
)

func TestPageResolve(t *testing.T) {
	cases := []struct {
		in          page
		limit, off  int
		badRequest  bool
	}{
		{page{}, 25, 0, false},
		{page{Limit: 10, Offset: 30}, 10, 30, false},
		{page{Limit: 1000}, 100, 0, false},
		{page{Limit: -1}, 0, 0, true},
		{page{Offset: -5}, 0, 0, true},
	}
	for _, tc := range cases {
		limit, off, err := tc.in.resolve()
		if tc.badRequest {
			if codeOf(err) != dashcontract.CodeBadRequest {
				t.Errorf("%+v: err = %v, want BAD_REQUEST", tc.in, err)
			}
			continue
		}
		if err != nil || limit != tc.limit || off != tc.off {
			t.Errorf("%+v: got %d %d %v, want %d %d", tc.in, limit, off, err, tc.limit, tc.off)
		}
	}
}

func TestEmptyIfNil(t *testing.T) {
	if m := emptyIfNil(nil); m == nil || len(m) != 0 {
		t.Errorf("nil: %v", m)
	}
	in := map[string]string{"a": "b"}
	if m := emptyIfNil(in); m["a"] != "b" {
		t.Errorf("kept: %v", m)
	}
}
```

`extension/contract/helpers_test.go`:

```go
package contract

import (
	"context"
	"errors"
	"hash/fnv"
	"path/filepath"
	"strings"
	"testing"

	"github.com/xraph/grove"
	"github.com/xraph/grove/drivers/sqlitedriver"
	_ "github.com/xraph/grove/drivers/sqlitedriver/sqlitemigrate" // registers the sqlite migrate executor

	dashauth "github.com/xraph/forge/extensions/dashboard/auth"
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/chunker"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/embedder"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/store"
	"github.com/xraph/weave/store/memory"
	"github.com/xraph/weave/store/sqlite"
	vsmemory "github.com/xraph/weave/vectorstore/memory"
)

// hashEmbedder is a deterministic bag-of-words embedder, so retrieval tests
// need no network. It mirrors the engine tests' helper.
type hashEmbedder struct{ dims int }

func (h hashEmbedder) Embed(_ context.Context, texts []string) ([]embedder.EmbedResult, error) {
	out := make([]embedder.EmbedResult, len(texts))
	for i, text := range texts {
		v := make([]float32, h.dims)
		for _, w := range strings.Fields(strings.ToLower(text)) {
			f := fnv.New32a()
			_, _ = f.Write([]byte(w))
			v[f.Sum32()%uint32(h.dims)]++
		}
		out[i] = embedder.EmbedResult{Vector: v}
	}
	return out, nil
}

func (h hashEmbedder) Dimensions() int { return h.dims }

// failingEmbedder fails every call, the way an embedding API out of quota
// does, after ingest has already written the document row.
type failingEmbedder struct{}

func (failingEmbedder) Embed(context.Context, []string) ([]embedder.EmbedResult, error) {
	return nil, errors.New("quota exceeded")
}

func (failingEmbedder) Dimensions() int { return 8 }

func openMemory(*testing.T) store.Store { return memory.New() }

func openSQLite(t *testing.T) store.Store {
	t.Helper()
	ctx := context.Background()
	drv := sqlitedriver.New()
	if err := drv.Open(ctx, filepath.Join(t.TempDir(), "weave.db")); err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	db, err := grove.Open(drv)
	if err != nil {
		t.Fatalf("grove.Open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	s := sqlite.New(db)
	if err := s.Migrate(ctx); err != nil {
		t.Fatalf("migrate sqlite: %v", err)
	}
	return s
}

// newDeps builds an engine on s with a memory vector store, the hashing
// embedder and the recursive chunker. opts are applied after those, so a
// test can replace the embedder.
func newDeps(t *testing.T, s store.Store, opts ...engine.Option) Deps {
	t.Helper()
	base := []engine.Option{
		engine.WithStore(s),
		engine.WithVectorStore(vsmemory.New()),
		engine.WithEmbedder(hashEmbedder{dims: 256}),
		engine.WithChunker(chunker.NewRecursiveChunker()),
	}
	e, err := engine.New(append(base, opts...)...)
	if err != nil {
		t.Fatalf("engine.New: %v", err)
	}
	return Deps{Engine: e}
}

// forEachStore runs fn on the memory store and on a real SQLite store, so
// every handler is checked against at least one real backend.
func forEachStore(t *testing.T, fn func(t *testing.T, deps Deps)) {
	t.Helper()
	for _, b := range []struct {
		name string
		open func(*testing.T) store.Store
	}{{"memory", openMemory}, {"sqlite", openSQLite}} {
		t.Run(b.name, func(t *testing.T) { fn(t, newDeps(t, b.open(t))) })
	}
}

func codeOf(err error) dashcontract.ErrorCode {
	var ce *dashcontract.Error
	if errors.As(err, &ce) {
		return ce.Code
	}
	return ""
}

func principal() dashcontract.Principal {
	return dashcontract.Principal{User: &dashauth.UserInfo{Subject: "operator"}}
}

func mustCollection(t *testing.T, deps Deps, name string) *collection.Collection {
	t.Helper()
	col := &collection.Collection{Name: name, ChunkSize: 512}
	if err := deps.Engine.CreateCollection(context.Background(), col); err != nil {
		t.Fatalf("create collection %q: %v", name, err)
	}
	return col
}

//nolint:revive // ctx second mirrors the engine tests' helper.
func mustIngest(t *testing.T, ctx context.Context, deps Deps, colID id.CollectionID, title, content string) id.DocumentID {
	t.Helper()
	res, err := deps.Engine.Ingest(ctx, &engine.IngestInput{CollectionID: colID, Title: title, Content: content})
	if err != nil {
		t.Fatalf("ingest %q: %v", title, err)
	}
	return res.DocumentID
}
```

Run: `go test ./extension/contract/`
Expected: FAIL to compile, `undefined: mapError`, `undefined: page`.

- [ ] **Step 5: Write errors.go and paging.go**

`extension/contract/errors.go`:

```go
package contract

import (
	"context"
	"errors"
	"strings"

	"github.com/xraph/forge"
	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave"
	"github.com/xraph/weave/id"
)

// mapError turns a Weave error into a *contract.Error the client can branch
// on. Anything unrecognised becomes CodeInternal with a generic message: a
// store error can carry a DSN or a host, so its text never reaches the
// client. Handlers call it through Deps.mapError, which logs that case.
func mapError(err error) error {
	if err == nil {
		return nil
	}
	var ce *contract.Error
	switch {
	case errors.As(err, &ce):
		return ce
	case errors.Is(err, weave.ErrCollectionNotFound):
		return notFound("collection not found")
	case errors.Is(err, weave.ErrDocumentNotFound):
		return notFound("document not found")
	case errors.Is(err, weave.ErrChunkNotFound):
		return notFound("chunk not found")
	case errors.Is(err, weave.ErrDuplicateDocument):
		return conflict("this collection already has a document with exactly the same content")
	case errors.Is(err, weave.ErrCollectionAlreadyExists):
		return conflict("a collection with this name already exists")
	case errors.Is(err, weave.ErrEmptyContent):
		return badRequest("content is empty")
	case errors.Is(err, weave.ErrInvalidArgument):
		reason := strings.TrimPrefix(err.Error(), weave.ErrInvalidArgument.Error()+": ")
		if reason == err.Error() {
			reason = "invalid argument"
		}
		return badRequest(reason)
	case errors.Is(err, weave.ErrNoStore):
		return unavailable("Weave has no metadata store configured")
	case errors.Is(err, weave.ErrNoEmbedder):
		return unavailable("Weave has no embedder configured, so it cannot ingest or search")
	case errors.Is(err, weave.ErrNoVectorStore):
		return unavailable("Weave has no vector store configured, so it cannot ingest or search")
	case errors.Is(err, weave.ErrNoChunker):
		return unavailable("Weave has no chunker configured, so it cannot ingest")
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		// A page that navigates away cancels its requests. That is
		// routine, so it is retryable and never logged as an error.
		return &contract.Error{Code: contract.CodeUnavailable, Message: "the request was cancelled or timed out", Retryable: true}
	default:
		return &contract.Error{Code: contract.CodeInternal, Message: "an internal error occurred"}
	}
}

// mapError maps err and, for CodeInternal with a logger set, logs the real
// error with the intent that hit it. That is the one case an operator
// cannot diagnose from what the client sees.
func (d Deps) mapError(intent string, err error) error {
	mapped := mapError(err)
	if d.Logger == nil || mapped == nil {
		return mapped
	}
	var ce *contract.Error
	if errors.As(mapped, &ce) && ce.Code == contract.CodeInternal {
		d.Logger.Error("weave/contract: internal error answering intent",
			forge.F("intent", intent),
			forge.F("error", err),
		)
	}
	return mapped
}

func badRequest(msg string) error  { return &contract.Error{Code: contract.CodeBadRequest, Message: msg} }
func notFound(msg string) error    { return &contract.Error{Code: contract.CodeNotFound, Message: msg} }
func conflict(msg string) error    { return &contract.Error{Code: contract.CodeConflict, Message: msg} }
func unavailable(msg string) error { return &contract.Error{Code: contract.CodeUnavailable, Message: msg} }

func parseCollectionID(field, s string) (id.CollectionID, error) {
	if strings.TrimSpace(s) == "" {
		return id.Nil, badRequest(field + " is required")
	}
	v, err := id.ParseCollectionID(s)
	if err != nil {
		return id.Nil, badRequest(field + " is not a collection ID")
	}
	return v, nil
}

func parseDocumentID(field, s string) (id.DocumentID, error) {
	if strings.TrimSpace(s) == "" {
		return id.Nil, badRequest(field + " is required")
	}
	v, err := id.ParseDocumentID(s)
	if err != nil {
		return id.Nil, badRequest(field + " is not a document ID")
	}
	return v, nil
}

func parseChunkID(field, s string) (id.ChunkID, error) {
	if strings.TrimSpace(s) == "" {
		return id.Nil, badRequest(field + " is required")
	}
	v, err := id.ParseChunkID(s)
	if err != nil {
		return id.Nil, badRequest(field + " is not a chunk ID")
	}
	return v, nil
}

// optionalCollectionID treats an empty value as "no filter".
func optionalCollectionID(field, s string) (id.CollectionID, error) {
	if s == "" {
		return id.Nil, nil
	}
	return parseCollectionID(field, s)
}

// optionalDocumentID treats an empty value as "no filter".
func optionalDocumentID(field, s string) (id.DocumentID, error) {
	if s == "" {
		return id.Nil, nil
	}
	return parseDocumentID(field, s)
}
```

`id.Nil` is the package's exported zero ID (`id/id.go`), and `CollectionID`, `DocumentID` and `ChunkID` are aliases of `id.ID`.

`extension/contract/paging.go`:

```go
package contract

const (
	defaultLimit = 25
	maxLimit     = 100
)

// page is embedded in every list input: `limit` and `offset` in, matching
// the stores' offset paging.
type page struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

// resolve applies the default and the cap. A negative value is refused: the
// memory store panics on a negative offset and the SQL backends return a
// raw error.
func (p page) resolve() (limit, offset int, err error) {
	if p.Limit < 0 || p.Offset < 0 {
		return 0, 0, badRequest("limit and offset cannot be negative")
	}
	limit = p.Limit
	if limit == 0 {
		limit = defaultLimit
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	return limit, p.Offset, nil
}

// listOutput is every list's answer: `items` and `total`, plus the limit
// and offset actually applied, so a page can show where it is.
type listOutput[T any] struct {
	Items  []T   `json:"items"`
	Total  int64 `json:"total"`
	Limit  int   `json:"limit"`
	Offset int   `json:"offset"`
}

// emptyIfNil keeps a metadata map from marshalling as null.
func emptyIfNil(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}
```

- [ ] **Step 6: Run, then commit**

Run: `go test ./extension/contract/ -v 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: TestManifest_Loads, TestManifest_CommandInvalidates, TestMapError (and its two siblings), TestParseIDs, TestPageResolve, TestEmptyIfNil PASS.

```bash
git add extension/contract/manifest.yaml extension/contract/contract.go extension/contract/errors.go extension/contract/paging.go extension/contract/helpers_test.go extension/contract/manifest_test.go extension/contract/errors_test.go extension/contract/paging_test.go
git commit --only -m "feat(contract): lay the weave contract's foundation" -- extension/contract/manifest.yaml extension/contract/contract.go extension/contract/errors.go extension/contract/paging.go extension/contract/helpers_test.go extension/contract/manifest_test.go extension/contract/errors_test.go extension/contract/paging_test.go
git show --stat HEAD
```

Some helpers (`forEachStore`, `mustIngest`, `failingEmbedder`, `principal`, `mustCollection`) are unused until later tasks; if lint flags them `unused`, that is expected until Task 8 and Task 10's gate clears it.

---

### Task 4: system.overview and system.components

**Files:**
- Create: `extension/contract/rows.go`
- Create: `extension/contract/handlers_system.go`
- Create: `extension/contract/handlers_system_test.go`
- Modify: `extension/contract/contract.go` (bindings)

**Interfaces:**
- Consumes: Task 3 (`Deps`, `query`, `mapError`, `emptyIfNil`), engine `CountCollections`, `CountDocuments`, `CountChunks`, `ListDocuments`, `GetCollection`, `Components`, `Config`, `DescribeExtensions`.
- Produces in rows.go: `type stateCounts struct{ Pending, Processing, Ready, Failed int64 }` (json `pending`, `processing`, `ready`, `failed`), `countStates(ctx, e *engine.Engine, colID id.CollectionID, tenant *string) (stateCounts, error)`, `type documentRow struct{ *document.Document; CollectionName string "collection_name"; Stalled bool "stalled" }`, `type nameCache`, `newNameCache(e *engine.Engine) *nameCache`, `(*nameCache).name(ctx, colID) string`, `(Deps).documentRow(ctx, cache *nameCache, d *document.Document) documentRow`, `type tenantInput struct{ Tenant *string "tenant" }`.
- Produces: `type overviewOutput`, `type componentsOutput`, `type engineConfig` (fields below).

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_system_test.go`:

```go
package contract

import (
	"context"
	"testing"
	"time"

	"github.com/xraph/weave"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/id"
)

func TestSystemOverview(t *testing.T) {
	forEachStore(t, func(t *testing.T, deps Deps) {
		ctx := context.Background()
		col := mustCollection(t, deps, "support")
		first := mustIngest(t, ctx, deps, col.ID, "refunds", "refunds are issued within thirty days")
		time.Sleep(5 * time.Millisecond)
		second := mustIngest(t, ctx, deps, col.ID, "shipping", "shipping takes five working days")

		// One document stuck in processing, last touched long ago as far
		// as the overview's clock is concerned.
		stuck := &document.Document{ID: id.NewDocumentID(), CollectionID: col.ID, Title: "stuck", ContentHash: "stuck", State: document.StateProcessing, Metadata: map[string]string{}}
		if err := deps.Engine.Store().CreateDocument(ctx, stuck); err != nil {
			t.Fatalf("seed stuck: %v", err)
		}
		deps.Now = func() time.Time { return time.Now().Add(StalledAfter + time.Minute) }

		out, err := systemOverviewHandler(deps)(ctx, tenantInput{}, principal())
		if err != nil {
			t.Fatalf("overview: %v", err)
		}
		if out.Collections != 1 || out.Documents != 3 || out.DocumentsByState.Ready != 2 || out.DocumentsByState.Processing != 1 {
			t.Errorf("counts: %+v", out)
		}
		if out.Chunks < 2 || out.Stalled != 1 || out.StalledAfterSeconds != int(StalledAfter.Seconds()) || out.Scope != "all" {
			t.Errorf("chunks/stalled/scope: %+v", out)
		}
		if len(out.NewestDocuments) != 3 || out.NewestDocuments[0].ID.String() != stuck.ID.String() ||
			out.NewestDocuments[1].ID.String() != second.String() || out.NewestDocuments[2].ID.String() != first.String() {
			t.Errorf("newest first: %+v", out.NewestDocuments)
		}
		if !out.NewestDocuments[0].Stalled || out.NewestDocuments[1].Stalled {
			t.Errorf("stalled flags: %+v", out.NewestDocuments)
		}
		if out.NewestDocuments[1].CollectionName != "support" {
			t.Errorf("collection name: %q", out.NewestDocuments[1].CollectionName)
		}
		if !out.Components.Embedder.Configured || out.Components.Retriever.Configured {
			t.Errorf("components: %+v", out.Components)
		}
	})
}

func TestSystemOverview_TenantFilter(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	col := mustCollection(t, deps, "mixed")
	mustIngest(t, weave.WithTenant(ctx, "t1"), deps, col.ID, "a", "alpha text")
	mustIngest(t, ctx, deps, col.ID, "b", "bravo text")

	empty := ""
	out, err := systemOverviewHandler(deps)(ctx, tenantInput{Tenant: &empty}, principal())
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if out.Documents != 1 || len(out.NewestDocuments) != 1 || out.NewestDocuments[0].Title != "b" {
		t.Errorf("tenant \"\": %+v", out)
	}
}

func TestSystemComponents(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	out, err := systemComponentsHandler(deps)(context.Background(), struct{}{}, principal())
	if err != nil {
		t.Fatalf("components: %v", err)
	}
	if out.Config.DefaultChunkSize != 512 || out.Config.DefaultTopK != 10 || out.Config.ShutdownTimeoutSeconds != 30 {
		t.Errorf("config: %+v", out.Config)
	}
	if out.Components.Chunker.Kind != "recursive" || out.Extensions == nil {
		t.Errorf("components %+v extensions %v", out.Components, out.Extensions)
	}
}
```

Run: `go test ./extension/contract/ -run TestSystem`
Expected: FAIL to compile, `undefined: systemOverviewHandler`.

- [ ] **Step 2: Write rows.go**

```go
package contract

import (
	"context"

	"github.com/xraph/weave/document"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
)

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

func countStates(ctx context.Context, e *engine.Engine, colID id.CollectionID, tenant *string) (stateCounts, error) {
	var out stateCounts
	for _, s := range []struct {
		state document.State
		into  *int64
	}{
		{document.StatePending, &out.Pending},
		{document.StateProcessing, &out.Processing},
		{document.StateReady, &out.Ready},
		{document.StateFailed, &out.Failed},
	} {
		n, err := e.CountDocuments(ctx, &document.CountFilter{CollectionID: colID, State: s.state, Tenant: tenant})
		if err != nil {
			return stateCounts{}, err
		}
		*s.into = n
	}
	return out, nil
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

// nameCache resolves collection names once per request.
type nameCache struct {
	e     *engine.Engine
	names map[string]string
}

func newNameCache(e *engine.Engine) *nameCache {
	return &nameCache{e: e, names: map[string]string{}}
}

// name answers "" for a collection that no longer exists.
func (c *nameCache) name(ctx context.Context, colID id.CollectionID) string {
	key := colID.String()
	if n, ok := c.names[key]; ok {
		return n
	}
	n := ""
	if col, err := c.e.GetCollection(ctx, colID); err == nil {
		n = col.Name
	}
	c.names[key] = n
	return n
}

func (d Deps) documentRow(ctx context.Context, cache *nameCache, doc *document.Document) documentRow {
	cp := *doc
	cp.Metadata = emptyIfNil(cp.Metadata)
	return documentRow{
		Document:       &cp,
		CollectionName: cache.name(ctx, cp.CollectionID),
		Stalled:        cp.State == document.StateProcessing && d.now().Sub(cp.UpdatedAt) > StalledAfter,
	}
}
```

- [ ] **Step 3: Write handlers_system.go**

```go
package contract

import (
	"context"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
)

// overviewNewest is how many of the newest documents the Overview lists.
const overviewNewest = 10

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

func systemOverviewHandler(deps Deps) func(context.Context, tenantInput, contract.Principal) (overviewOutput, error) {
	return func(ctx context.Context, in tenantInput, _ contract.Principal) (overviewOutput, error) {
		const intent = "system.overview"
		e := deps.Engine
		out := overviewOutput{StalledAfterSeconds: int(StalledAfter.Seconds()), Scope: "all", NewestDocuments: []documentRow{}, Components: e.Components()}
		var err error
		if out.Collections, err = e.CountCollections(ctx, &collection.CountFilter{Tenant: in.Tenant}); err != nil {
			return overviewOutput{}, deps.mapError(intent, err)
		}
		if out.Documents, err = e.CountDocuments(ctx, &document.CountFilter{Tenant: in.Tenant}); err != nil {
			return overviewOutput{}, deps.mapError(intent, err)
		}
		if out.DocumentsByState, err = countStates(ctx, e, id.Nil, in.Tenant); err != nil {
			return overviewOutput{}, deps.mapError(intent, err)
		}
		if out.Chunks, err = e.CountChunks(ctx, &chunk.CountFilter{Tenant: in.Tenant}); err != nil {
			return overviewOutput{}, deps.mapError(intent, err)
		}
		if out.Stalled, err = e.CountDocuments(ctx, &document.CountFilter{
			State: document.StateProcessing, UpdatedBefore: deps.now().Add(-StalledAfter), Tenant: in.Tenant,
		}); err != nil {
			return overviewOutput{}, deps.mapError(intent, err)
		}
		docs, err := e.ListDocuments(ctx, &document.ListFilter{SortDesc: true, Limit: overviewNewest, Tenant: in.Tenant})
		if err != nil {
			return overviewOutput{}, deps.mapError(intent, err)
		}
		cache := newNameCache(e)
		for _, d := range docs {
			out.NewestDocuments = append(out.NewestDocuments, deps.documentRow(ctx, cache, d))
		}
		return out, nil
	}
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

func systemComponentsHandler(deps Deps) func(context.Context, struct{}, contract.Principal) (componentsOutput, error) {
	return func(_ context.Context, _ struct{}, _ contract.Principal) (componentsOutput, error) {
		e := deps.Engine
		cfg := e.Config()
		return componentsOutput{
			Components: e.Components(),
			Config: engineConfig{
				DefaultChunkSize:       cfg.DefaultChunkSize,
				DefaultChunkOverlap:    cfg.DefaultChunkOverlap,
				DefaultEmbeddingModel:  cfg.DefaultEmbeddingModel,
				DefaultChunkStrategy:   cfg.DefaultChunkStrategy,
				DefaultTopK:            cfg.DefaultTopK,
				ShutdownTimeoutSeconds: cfg.ShutdownTimeout.Seconds(),
			},
			Extensions: e.DescribeExtensions(),
		}, nil
	}
}
```

`id.Nil` as the collection means "every collection" in `document.CountFilter`.

- [ ] **Step 4: Bind both intents**

In `contract.go`, make `bindings` return:

```go
	return []binding{
		query("system.overview", systemOverviewHandler(deps)),
		query("system.components", systemComponentsHandler(deps)),
	}
```

- [ ] **Step 5: Run, then commit**

Run: `go test ./extension/contract/ -run TestSystem -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: TestSystemOverview (memory and sqlite), TestSystemOverview_TenantFilter, TestSystemComponents PASS.

```bash
git add extension/contract/rows.go extension/contract/handlers_system.go extension/contract/handlers_system_test.go
git commit --only -m "feat(contract): answer the overview and the component report" -- extension/contract/rows.go extension/contract/handlers_system.go extension/contract/handlers_system_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 5: Collections

**Files:**
- Create: `extension/contract/handlers_collections.go`
- Create: `extension/contract/handlers_collections_test.go`
- Modify: `extension/contract/contract.go` (bindings)

**Interfaces:**
- Consumes: Tasks 3-4 (`page`, `listOutput`, `stateCounts`, `countStates`, `parseCollectionID`, `mapError`), engine `ListCollections`, `CountCollections`, `CountDocuments`, `CountChunks`, `GetCollection`, `CreateCollection`, `UpdateCollection`, `DeleteCollection`, `ReindexCollection`, `Config`, `Components`.
- Produces: `type collectionRow struct{ *collection.Collection; DocumentCount int64 "document_count"; ChunkCount int64 "chunk_count" }`, `type collectionDetail struct{ collectionRow; DocumentsByState stateCounts "documents_by_state"; Stalled int64 "stalled" }`, `type idInput struct{ ID string "id" }`, `type idOutput struct{ ID string "id" }`, handlers `collectionsListHandler`, `collectionsGetHandler`, `collectionsCreateHandler`, `collectionsUpdateHandler`, `collectionsDeleteHandler`, `collectionsReindexHandler`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_collections_test.go`:

```go
package contract

import (
	"context"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/id"
)

func TestCollectionsCreateListGet(t *testing.T) {
	forEachStore(t, func(t *testing.T, deps Deps) {
		ctx := context.Background()
		p := principal()

		created, err := collectionsCreateHandler(deps)(ctx, collectionCreateInput{
			Name: "  Support  ", Description: "help centre", ChunkSize: 400, ChunkOverlap: 40,
			Metadata: map[string]string{"team": "cx"},
		}, p)
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		if created.Name != "Support" || created.ChunkSize != 400 || created.EmbeddingDims != 256 || created.Metadata["team"] != "cx" {
			t.Errorf("created: %+v", created.Collection)
		}
		mustIngest(t, ctx, deps, created.ID, "refunds", "refunds are issued within thirty days")

		list, err := collectionsListHandler(deps)(ctx, collectionsListInput{}, p)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		if list.Total != 1 || len(list.Items) != 1 || list.Items[0].DocumentCount != 1 || list.Items[0].ChunkCount < 1 {
			t.Errorf("list: %+v", list)
		}
		if list.Limit != 25 || list.Offset != 0 {
			t.Errorf("paging echo: %+v", list)
		}

		got, err := collectionsGetHandler(deps)(ctx, idInput{ID: created.ID.String()}, p)
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.DocumentsByState.Ready != 1 || got.DocumentCount != 1 || got.CreatedAt.IsZero() {
			t.Errorf("get: %+v", got)
		}

		if _, err := collectionsCreateHandler(deps)(ctx, collectionCreateInput{Name: "Support"}, p); codeOf(err) != dashcontract.CodeConflict {
			t.Errorf("duplicate name: %v", err)
		}
	})
}

func TestCollectionsCreate_Validation(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	for name, in := range map[string]collectionCreateInput{
		"blank name":          {Name: "   "},
		"negative size":       {Name: "a", ChunkSize: -1},
		"overlap at size":     {Name: "b", ChunkSize: 100, ChunkOverlap: 100},
		"overlap over default": {Name: "c", ChunkOverlap: 600},
	} {
		if _, err := collectionsCreateHandler(deps)(ctx, in, principal()); codeOf(err) != dashcontract.CodeBadRequest {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestCollectionsGet_IDs(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	if _, err := collectionsGetHandler(deps)(ctx, idInput{ID: "garbage"}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("garbage: %v", err)
	}
	if _, err := collectionsGetHandler(deps)(ctx, idInput{ID: id.NewCollectionID().String()}, principal()); codeOf(err) != dashcontract.CodeNotFound {
		t.Errorf("missing: %v", err)
	}
}

func TestCollectionsList_TenantAndPaging(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	if err := deps.Engine.CreateCollection(weave.WithTenant(ctx, "t1"), &collection.Collection{Name: "tenanted"}); err != nil {
		t.Fatal(err)
	}
	mustCollection(t, deps, "open")

	empty := ""
	out, err := collectionsListHandler(deps)(ctx, collectionsListInput{Tenant: &empty}, principal())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if out.Total != 1 || out.Items[0].Name != "open" {
		t.Errorf("tenant \"\": %+v", out)
	}
	all, _ := collectionsListHandler(deps)(ctx, collectionsListInput{}, principal())
	if all.Total != 2 {
		t.Errorf("no tenant: total %d", all.Total)
	}
	if _, err := collectionsListHandler(deps)(ctx, collectionsListInput{page: page{Offset: -1}}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("negative offset: %v", err)
	}
}

func TestCollectionsUpdateDeleteReindex(t *testing.T) {
	forEachStore(t, func(t *testing.T, deps Deps) {
		ctx := context.Background()
		p := principal()
		col := mustCollection(t, deps, "billing")
		mustIngest(t, ctx, deps, col.ID, "invoice", "invoices are sent monthly")

		name := "Billing"
		up, err := collectionsUpdateHandler(deps)(ctx, collectionUpdateInput{ID: col.ID.String(), Name: &name}, p)
		if err != nil || up.Name != "Billing" || up.DocumentCount != 1 {
			t.Fatalf("update: %+v %v", up, err)
		}

		re, err := collectionsReindexHandler(deps)(ctx, idInput{ID: col.ID.String()}, p)
		if err != nil || re.ReindexedDocuments != 1 || re.ID != col.ID.String() {
			t.Fatalf("reindex: %+v %v", re, err)
		}
		if _, err := collectionsReindexHandler(deps)(ctx, idInput{ID: id.NewCollectionID().String()}, p); codeOf(err) != dashcontract.CodeNotFound {
			t.Errorf("reindex missing: %v", err)
		}

		if _, err := collectionsDeleteHandler(deps)(ctx, idInput{ID: col.ID.String()}, p); err != nil {
			t.Fatalf("delete: %v", err)
		}
		if _, err := collectionsDeleteHandler(deps)(ctx, idInput{ID: col.ID.String()}, p); codeOf(err) != dashcontract.CodeNotFound {
			t.Errorf("delete again: %v", err)
		}
	})
}
```

Run: `go test ./extension/contract/ -run TestCollections`
Expected: FAIL to compile, `undefined: collectionsCreateHandler`.

- [ ] **Step 2: Write handlers_collections.go**

```go
package contract

import (
	"context"
	"strings"
	"time"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/engine"
)

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

func (d Deps) collectionRow(ctx context.Context, col *collection.Collection) (collectionRow, error) {
	cp := *col
	cp.Metadata = emptyIfNil(cp.Metadata)
	docs, err := d.Engine.CountDocuments(ctx, &document.CountFilter{CollectionID: cp.ID})
	if err != nil {
		return collectionRow{}, err
	}
	chunks, err := d.Engine.CountChunks(ctx, &chunk.CountFilter{CollectionID: cp.ID})
	if err != nil {
		return collectionRow{}, err
	}
	return collectionRow{Collection: &cp, DocumentCount: docs, ChunkCount: chunks}, nil
}

func collectionsListHandler(deps Deps) func(context.Context, collectionsListInput, contract.Principal) (listOutput[collectionRow], error) {
	return func(ctx context.Context, in collectionsListInput, _ contract.Principal) (listOutput[collectionRow], error) {
		const intent = "collections.list"
		limit, offset, err := in.resolve()
		if err != nil {
			return listOutput[collectionRow]{}, err
		}
		cols, err := deps.Engine.ListCollections(ctx, &collection.ListFilter{Search: in.Search, Limit: limit, Offset: offset, SortDesc: true, Tenant: in.Tenant})
		if err != nil {
			return listOutput[collectionRow]{}, deps.mapError(intent, err)
		}
		total, err := deps.Engine.CountCollections(ctx, &collection.CountFilter{Search: in.Search, Tenant: in.Tenant})
		if err != nil {
			return listOutput[collectionRow]{}, deps.mapError(intent, err)
		}
		out := listOutput[collectionRow]{Items: make([]collectionRow, 0, len(cols)), Total: total, Limit: limit, Offset: offset}
		for _, c := range cols {
			row, err := deps.collectionRow(ctx, c)
			if err != nil {
				return listOutput[collectionRow]{}, deps.mapError(intent, err)
			}
			out.Items = append(out.Items, row)
		}
		return out, nil
	}
}

func collectionsGetHandler(deps Deps) func(context.Context, idInput, contract.Principal) (collectionDetail, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (collectionDetail, error) {
		const intent = "collections.get"
		colID, err := parseCollectionID("id", in.ID)
		if err != nil {
			return collectionDetail{}, err
		}
		col, err := deps.Engine.GetCollection(ctx, colID)
		if err != nil {
			return collectionDetail{}, deps.mapError(intent, err)
		}
		row, err := deps.collectionRow(ctx, col)
		if err != nil {
			return collectionDetail{}, deps.mapError(intent, err)
		}
		states, err := countStates(ctx, deps.Engine, colID, nil)
		if err != nil {
			return collectionDetail{}, deps.mapError(intent, err)
		}
		stalled, err := deps.Engine.CountDocuments(ctx, &document.CountFilter{
			CollectionID: colID, State: document.StateProcessing, UpdatedBefore: deps.now().Add(-StalledAfter),
		})
		if err != nil {
			return collectionDetail{}, deps.mapError(intent, err)
		}
		return collectionDetail{collectionRow: row, DocumentsByState: states, Stalled: stalled}, nil
	}
}

// collectionsCreateHandler records the embedder's real dimensions. The
// model and strategy it records are the engine's defaults; Weave records
// them and never reads them back, which the form says.
func collectionsCreateHandler(deps Deps) func(context.Context, collectionCreateInput, contract.Principal) (collectionRow, error) {
	return func(ctx context.Context, in collectionCreateInput, _ contract.Principal) (collectionRow, error) {
		const intent = "collections.create"
		name := strings.TrimSpace(in.Name)
		if name == "" {
			return collectionRow{}, badRequest("name is required")
		}
		if in.ChunkSize < 0 || in.ChunkOverlap < 0 {
			return collectionRow{}, badRequest("chunk size and overlap cannot be negative")
		}
		cfg := deps.Engine.Config()
		size, overlap := in.ChunkSize, in.ChunkOverlap
		if size == 0 {
			size = cfg.DefaultChunkSize
		}
		if overlap == 0 {
			// The engine treats 0 as "use the default", so the check
			// must too.
			overlap = cfg.DefaultChunkOverlap
		}
		if overlap >= size {
			return collectionRow{}, badRequest("chunk overlap must be smaller than chunk size")
		}
		col := &collection.Collection{
			Name: name, Description: in.Description,
			ChunkSize: in.ChunkSize, ChunkOverlap: in.ChunkOverlap,
			Metadata: emptyIfNil(in.Metadata),
		}
		if emb := deps.Engine.Components().Embedder; emb.Configured {
			col.EmbeddingDims = emb.Dimensions
		}
		if err := deps.Engine.CreateCollection(ctx, col); err != nil {
			return collectionRow{}, deps.mapError(intent, err)
		}
		row, err := deps.collectionRow(ctx, col)
		if err != nil {
			return collectionRow{}, deps.mapError(intent, err)
		}
		return row, nil
	}
}

func collectionsUpdateHandler(deps Deps) func(context.Context, collectionUpdateInput, contract.Principal) (collectionRow, error) {
	return func(ctx context.Context, in collectionUpdateInput, _ contract.Principal) (collectionRow, error) {
		const intent = "collections.update"
		colID, err := parseCollectionID("id", in.ID)
		if err != nil {
			return collectionRow{}, err
		}
		col, err := deps.Engine.UpdateCollection(ctx, colID, engine.CollectionUpdate{Name: in.Name, Description: in.Description, Metadata: in.Metadata})
		if err != nil {
			return collectionRow{}, deps.mapError(intent, err)
		}
		row, err := deps.collectionRow(ctx, col)
		if err != nil {
			return collectionRow{}, deps.mapError(intent, err)
		}
		return row, nil
	}
}

func collectionsDeleteHandler(deps Deps) func(context.Context, idInput, contract.Principal) (idOutput, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (idOutput, error) {
		colID, err := parseCollectionID("id", in.ID)
		if err != nil {
			return idOutput{}, err
		}
		if err := deps.Engine.DeleteCollection(ctx, colID); err != nil {
			return idOutput{}, deps.mapError("collections.delete", err)
		}
		return idOutput{ID: colID.String()}, nil
	}
}

// collectionsReindexHandler re-embeds the collection's ready documents. It
// checks the collection exists first: the engine's reindex would delete
// nothing and report success for an ID that does not exist.
func collectionsReindexHandler(deps Deps) func(context.Context, idInput, contract.Principal) (reindexOutput, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (reindexOutput, error) {
		const intent = "collections.reindex"
		colID, err := parseCollectionID("id", in.ID)
		if err != nil {
			return reindexOutput{}, err
		}
		if _, err := deps.Engine.GetCollection(ctx, colID); err != nil {
			return reindexOutput{}, deps.mapError(intent, err)
		}
		ready, err := deps.Engine.CountDocuments(ctx, &document.CountFilter{CollectionID: colID, State: document.StateReady})
		if err != nil {
			return reindexOutput{}, deps.mapError(intent, err)
		}
		start := time.Now()
		if err := deps.Engine.ReindexCollection(ctx, colID); err != nil {
			return reindexOutput{}, deps.mapError(intent, err)
		}
		return reindexOutput{ID: colID.String(), ReindexedDocuments: ready, ElapsedMillis: float64(time.Since(start).Microseconds()) / 1000}, nil
	}
}
```

- [ ] **Step 3: Bind the six intents**

Append to `bindings`:

```go
		query("collections.list", collectionsListHandler(deps)),
		query("collections.get", collectionsGetHandler(deps)),
		command("collections.create", collectionsCreateHandler(deps)),
		command("collections.update", collectionsUpdateHandler(deps)),
		command("collections.delete", collectionsDeleteHandler(deps)),
		command("collections.reindex", collectionsReindexHandler(deps)),
```

- [ ] **Step 4: Run, then commit**

Run: `go test ./extension/contract/ -run TestCollections -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: all PASS on memory and sqlite.

```bash
git add extension/contract/handlers_collections.go extension/contract/handlers_collections_test.go
git commit --only -m "feat(contract): list, create, edit, delete and reindex collections" -- extension/contract/handlers_collections.go extension/contract/handlers_collections_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 6: Documents

**Files:**
- Create: `extension/contract/handlers_documents.go`
- Create: `extension/contract/handlers_documents_test.go`
- Modify: `extension/contract/contract.go` (bindings)

**Interfaces:**
- Consumes: Tasks 3-5 (`page`, `listOutput`, `documentRow`, `nameCache`, `idInput`, `idOutput`, `parse*ID`, `optionalCollectionID`), engine `ListDocuments`, `CountDocuments`, `GetDocument`, `ListChunks`, `CountChunks`, `Ingest`, `DeleteDocument`.
- Produces: `maxIngestBytes = 1 << 20`, `spanCap = 5000`, `type span`, `type spansOutput`, `type ingestInput`, `type ingestOutput`, handlers `documentsListHandler`, `documentsGetHandler`, `documentsSpansHandler`, `documentsIngestHandler`, `documentsDeleteHandler`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_documents_test.go`:

```go
package contract

import (
	"context"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
)

func TestDocumentsIngestListGetSpansDelete(t *testing.T) {
	forEachStore(t, func(t *testing.T, deps Deps) {
		ctx := context.Background()
		p := principal()
		col := mustCollection(t, deps, "kb")

		out, err := documentsIngestHandler(deps)(ctx, ingestInput{
			CollectionID: col.ID.String(), Title: "refunds", Source: "upload://refunds.md",
			SourceType: "text/markdown", Content: "refunds are issued within thirty days",
			Metadata: map[string]string{"lang": "en"},
		}, p)
		if err != nil || out.State != "ready" || out.ChunkCount < 1 || out.Error != "" || out.DocumentID == "" {
			t.Fatalf("ingest: %+v %v", out, err)
		}

		if _, err := documentsIngestHandler(deps)(ctx, ingestInput{CollectionID: col.ID.String(), Content: "refunds are issued within thirty days"}, p); codeOf(err) != dashcontract.CodeConflict {
			t.Errorf("duplicate: %v", err)
		}

		list, err := documentsListHandler(deps)(ctx, documentsListInput{CollectionID: col.ID.String(), State: "ready"}, p)
		if err != nil || list.Total != 1 || list.Items[0].CollectionName != "kb" || list.Items[0].Metadata["lang"] != "en" {
			t.Fatalf("list: %+v %v", list, err)
		}

		got, err := documentsGetHandler(deps)(ctx, idInput{ID: out.DocumentID}, p)
		if err != nil || got.Title != "refunds" || got.SourceType != "text/markdown" || got.Stalled {
			t.Fatalf("get: %+v %v", got, err)
		}

		spans, err := documentsSpansHandler(deps)(ctx, idInput{ID: out.DocumentID}, p)
		if err != nil || !spans.Complete || int(spans.Total) != len(spans.Spans) || spans.Spans[0].EndOffset == 0 || spans.ContentLength == 0 {
			t.Fatalf("spans: %+v %v", spans, err)
		}

		if _, err := documentsDeleteHandler(deps)(ctx, idInput{ID: out.DocumentID}, p); err != nil {
			t.Fatalf("delete: %v", err)
		}
		if _, err := documentsGetHandler(deps)(ctx, idInput{ID: out.DocumentID}, p); codeOf(err) != dashcontract.CodeNotFound {
			t.Errorf("get after delete: %v", err)
		}
	})
}

// A failed ingest still wrote a document row, so it is an answer, not an
// error: the page shows the stored reason and links to the document.
func TestDocumentsIngest_FailureIsAnAnswer(t *testing.T) {
	deps := newDeps(t, openMemory(t), engine.WithEmbedder(failingEmbedder{}))
	ctx := context.Background()
	col := mustCollection(t, deps, "kb")
	out, err := documentsIngestHandler(deps)(ctx, ingestInput{CollectionID: col.ID.String(), Content: "anything at all"}, principal())
	if err != nil {
		t.Fatalf("ingest answered an error: %v", err)
	}
	if out.State != "failed" || !strings.Contains(out.Error, "quota exceeded") || out.DocumentID == "" {
		t.Errorf("failed ingest: %+v", out)
	}
}

func TestDocumentsIngest_Validation(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	col := mustCollection(t, deps, "kb")
	big := strings.Repeat("a", maxIngestBytes+1)
	cases := map[string]struct {
		in   ingestInput
		code dashcontract.ErrorCode
	}{
		"no collection":      {ingestInput{Content: "x"}, dashcontract.CodeBadRequest},
		"bad collection":     {ingestInput{CollectionID: "nope", Content: "x"}, dashcontract.CodeBadRequest},
		"missing collection": {ingestInput{CollectionID: id.NewCollectionID().String(), Content: "x"}, dashcontract.CodeNotFound},
		"blank content":      {ingestInput{CollectionID: col.ID.String(), Content: "  \n "}, dashcontract.CodeBadRequest},
		"over 1 MiB":         {ingestInput{CollectionID: col.ID.String(), Content: big}, dashcontract.CodeBadRequest},
	}
	for name, tc := range cases {
		if _, err := documentsIngestHandler(deps)(ctx, tc.in, principal()); codeOf(err) != tc.code {
			t.Errorf("%s: %v, want %s", name, err, tc.code)
		}
	}
}

func TestDocumentsList_Validation(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	if _, err := documentsListHandler(deps)(ctx, documentsListInput{State: "archived"}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("bad state: %v", err)
	}
	if _, err := documentsListHandler(deps)(ctx, documentsListInput{CollectionID: "nope"}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("bad collection: %v", err)
	}
	if _, err := documentsGetHandler(deps)(ctx, idInput{ID: id.NewDocumentID().String()}, principal()); codeOf(err) != dashcontract.CodeNotFound {
		t.Errorf("missing document: %v", err)
	}
	if _, err := documentsSpansHandler(deps)(ctx, idInput{ID: "nope"}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("bad spans id: %v", err)
	}
}
```

Run: `go test ./extension/contract/ -run TestDocuments`
Expected: FAIL to compile, `undefined: documentsIngestHandler`.

- [ ] **Step 2: Write handlers_documents.go**

```go
package contract

import (
	"context"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/chunk"
	"github.com/xraph/weave/document"
	"github.com/xraph/weave/engine"
)

// maxIngestBytes is the largest content the dashboard ingests. Content
// travels inside the contract envelope, and ingest runs synchronously
// inside the request.
const maxIngestBytes = 1 << 20

// spanCap is how many chunk spans documents.spans returns. Past it the
// answer says complete: false rather than silently truncating.
const spanCap = 5000

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

func validState(s string) bool {
	switch document.State(s) {
	case "", document.StatePending, document.StateProcessing, document.StateReady, document.StateFailed:
		return true
	}
	return false
}

func documentsListHandler(deps Deps) func(context.Context, documentsListInput, contract.Principal) (listOutput[documentRow], error) {
	return func(ctx context.Context, in documentsListInput, _ contract.Principal) (listOutput[documentRow], error) {
		const intent = "documents.list"
		limit, offset, err := in.resolve()
		if err != nil {
			return listOutput[documentRow]{}, err
		}
		if !validState(in.State) {
			return listOutput[documentRow]{}, badRequest("state must be pending, processing, ready or failed")
		}
		colID, err := optionalCollectionID("collection_id", in.CollectionID)
		if err != nil {
			return listOutput[documentRow]{}, err
		}
		state := document.State(in.State)
		docs, err := deps.Engine.ListDocuments(ctx, &document.ListFilter{
			CollectionID: colID, State: state, Search: in.Search, Limit: limit, Offset: offset, SortDesc: true, Tenant: in.Tenant,
		})
		if err != nil {
			return listOutput[documentRow]{}, deps.mapError(intent, err)
		}
		total, err := deps.Engine.CountDocuments(ctx, &document.CountFilter{CollectionID: colID, State: state, Search: in.Search, Tenant: in.Tenant})
		if err != nil {
			return listOutput[documentRow]{}, deps.mapError(intent, err)
		}
		cache := newNameCache(deps.Engine)
		out := listOutput[documentRow]{Items: make([]documentRow, 0, len(docs)), Total: total, Limit: limit, Offset: offset}
		for _, d := range docs {
			out.Items = append(out.Items, deps.documentRow(ctx, cache, d))
		}
		return out, nil
	}
}

func documentsGetHandler(deps Deps) func(context.Context, idInput, contract.Principal) (documentRow, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (documentRow, error) {
		docID, err := parseDocumentID("id", in.ID)
		if err != nil {
			return documentRow{}, err
		}
		doc, err := deps.Engine.GetDocument(ctx, docID)
		if err != nil {
			return documentRow{}, deps.mapError("documents.get", err)
		}
		return deps.documentRow(ctx, newNameCache(deps.Engine), doc), nil
	}
}

func documentsSpansHandler(deps Deps) func(context.Context, idInput, contract.Principal) (spansOutput, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (spansOutput, error) {
		const intent = "documents.spans"
		docID, err := parseDocumentID("id", in.ID)
		if err != nil {
			return spansOutput{}, err
		}
		doc, err := deps.Engine.GetDocument(ctx, docID)
		if err != nil {
			return spansOutput{}, deps.mapError(intent, err)
		}
		chunks, err := deps.Engine.ListChunks(ctx, &chunk.ListFilter{DocumentID: docID, Limit: spanCap})
		if err != nil {
			return spansOutput{}, deps.mapError(intent, err)
		}
		total, err := deps.Engine.CountChunks(ctx, &chunk.CountFilter{DocumentID: docID})
		if err != nil {
			return spansOutput{}, deps.mapError(intent, err)
		}
		out := spansOutput{DocumentID: docID.String(), ContentLength: doc.ContentLength, Spans: make([]span, 0, len(chunks)), Total: total, Complete: total <= spanCap}
		for _, c := range chunks {
			out.Spans = append(out.Spans, span{ID: c.ID.String(), Index: c.Index, StartOffset: c.StartOffset, EndOffset: c.EndOffset, TokenCount: c.TokenCount})
		}
		return out, nil
	}
}

func documentsIngestHandler(deps Deps) func(context.Context, ingestInput, contract.Principal) (ingestOutput, error) {
	return func(ctx context.Context, in ingestInput, _ contract.Principal) (ingestOutput, error) {
		const intent = "documents.ingest"
		colID, err := parseCollectionID("collection_id", in.CollectionID)
		if err != nil {
			return ingestOutput{}, err
		}
		if strings.TrimSpace(in.Content) == "" {
			return ingestOutput{}, badRequest("content is empty")
		}
		if len(in.Content) > maxIngestBytes {
			return ingestOutput{}, badRequest("content is larger than 1 MiB; the dashboard ingests up to 1 MiB")
		}
		res, err := deps.Engine.Ingest(ctx, &engine.IngestInput{
			CollectionID: colID, Title: in.Title, Source: in.Source, SourceType: in.SourceType,
			Content: in.Content, Metadata: in.Metadata,
		})
		if err != nil && res != nil && res.State == document.StateFailed {
			out := ingestOutput{DocumentID: res.DocumentID.String(), State: string(res.State), Error: err.Error()}
			if doc, getErr := deps.Engine.GetDocument(ctx, res.DocumentID); getErr == nil && doc.Error != "" {
				out.Error = doc.Error
			}
			return out, nil
		}
		if err != nil {
			return ingestOutput{}, deps.mapError(intent, err)
		}
		return ingestOutput{DocumentID: res.DocumentID.String(), State: string(res.State), ChunkCount: res.ChunkCount}, nil
	}
}

func documentsDeleteHandler(deps Deps) func(context.Context, idInput, contract.Principal) (idOutput, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (idOutput, error) {
		docID, err := parseDocumentID("id", in.ID)
		if err != nil {
			return idOutput{}, err
		}
		if err := deps.Engine.DeleteDocument(ctx, docID); err != nil {
			return idOutput{}, deps.mapError("documents.delete", err)
		}
		return idOutput{ID: docID.String()}, nil
	}
}
```

- [ ] **Step 3: Bind the five intents**

Append to `bindings`:

```go
		query("documents.list", documentsListHandler(deps)),
		query("documents.get", documentsGetHandler(deps)),
		query("documents.spans", documentsSpansHandler(deps)),
		command("documents.ingest", documentsIngestHandler(deps)),
		command("documents.delete", documentsDeleteHandler(deps)),
```

- [ ] **Step 4: Run, then commit**

Run: `go test ./extension/contract/ -run TestDocuments -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: all PASS (memory and sqlite for the round trip).

If `documents.delete` of a missing ID answers something other than `NOT_FOUND`, check `engine.DeleteDocument`: it deletes vectors and chunks before the document, and the store's `DeleteDocument` returns `ErrDocumentNotFound`; the round-trip test covers the present case and Task 9's walk covers a missing one.

```bash
git add extension/contract/handlers_documents.go extension/contract/handlers_documents_test.go
git commit --only -m "feat(contract): list, read, ingest and delete documents" -- extension/contract/handlers_documents.go extension/contract/handlers_documents_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 7: Chunks

**Files:**
- Create: `extension/contract/handlers_chunks.go`
- Create: `extension/contract/handlers_chunks_test.go`
- Modify: `extension/contract/contract.go` (bindings)

**Interfaces:**
- Consumes: Tasks 3-6, engine `ListChunks`, `CountChunks`, `GetChunk`, `GetDocument`.
- Produces: `type chunksListInput`, `type chunkDetail struct{ Chunk *chunk.Chunk "chunk"; DocumentTitle string "document_title"; PreviousID string "previous_id"; NextID string "next_id" }`, handlers `chunksListHandler`, `chunksGetHandler`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_chunks_test.go`:

```go
package contract

import (
	"context"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/collection"
	"github.com/xraph/weave/id"
)

func TestChunksListAndGet(t *testing.T) {
	forEachStore(t, func(t *testing.T, deps Deps) {
		ctx := context.Background()
		p := principal()
		col := &collection.Collection{Name: "long", ChunkSize: 8, ChunkOverlap: 2}
		if err := deps.Engine.CreateCollection(ctx, col); err != nil {
			t.Fatal(err)
		}
		text := strings.Repeat("words that keep going ", 40)
		doc := mustIngest(t, ctx, deps, col.ID, "long", text)

		list, err := chunksListHandler(deps)(ctx, chunksListInput{DocumentID: doc.String(), page: page{Limit: 2, Offset: 1}}, p)
		if err != nil || len(list.Items) != 2 || list.Total < 3 || list.Items[0].Index != 1 {
			t.Fatalf("list: %+v %v", list, err)
		}
		for _, c := range list.Items {
			if c.Metadata == nil {
				t.Error("metadata marshals as null")
			}
		}

		mid := list.Items[0]
		got, err := chunksGetHandler(deps)(ctx, idInput{ID: mid.ID.String()}, p)
		if err != nil || got.Chunk.ID.String() != mid.ID.String() || got.DocumentTitle != "long" || got.PreviousID == "" || got.NextID == "" {
			t.Fatalf("get: %+v %v", got, err)
		}

		byCol, err := chunksListHandler(deps)(ctx, chunksListInput{CollectionID: col.ID.String()}, p)
		if err != nil || byCol.Total != list.Total {
			t.Errorf("by collection: %+v %v", byCol, err)
		}
	})
}

func TestChunks_Validation(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	if _, err := chunksListHandler(deps)(ctx, chunksListInput{}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("no scope: %v", err)
	}
	if _, err := chunksGetHandler(deps)(ctx, idInput{ID: "nope"}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("bad id: %v", err)
	}
	if _, err := chunksGetHandler(deps)(ctx, idInput{ID: id.NewChunkID().String()}, principal()); codeOf(err) != dashcontract.CodeNotFound {
		t.Errorf("missing: %v", err)
	}
}
```

The ingest in the first test uses chunk size 8 so the recursive chunker produces several chunks; if it produces fewer than 3, raise the repeat count, not the assertions.

Run: `go test ./extension/contract/ -run TestChunks`
Expected: FAIL to compile, `undefined: chunksListHandler`.

- [ ] **Step 2: Write handlers_chunks.go**

```go
package contract

import (
	"context"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave/chunk"
)

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

func copyChunk(c *chunk.Chunk) *chunk.Chunk {
	cp := *c
	cp.Metadata = emptyIfNil(cp.Metadata)
	return &cp
}

func chunksListHandler(deps Deps) func(context.Context, chunksListInput, contract.Principal) (listOutput[*chunk.Chunk], error) {
	return func(ctx context.Context, in chunksListInput, _ contract.Principal) (listOutput[*chunk.Chunk], error) {
		const intent = "chunks.list"
		limit, offset, err := in.resolve()
		if err != nil {
			return listOutput[*chunk.Chunk]{}, err
		}
		docID, err := optionalDocumentID("document_id", in.DocumentID)
		if err != nil {
			return listOutput[*chunk.Chunk]{}, err
		}
		colID, err := optionalCollectionID("collection_id", in.CollectionID)
		if err != nil {
			return listOutput[*chunk.Chunk]{}, err
		}
		chunks, err := deps.Engine.ListChunks(ctx, &chunk.ListFilter{DocumentID: docID, CollectionID: colID, Tenant: in.Tenant, Limit: limit, Offset: offset})
		if err != nil {
			return listOutput[*chunk.Chunk]{}, deps.mapError(intent, err)
		}
		total, err := deps.Engine.CountChunks(ctx, &chunk.CountFilter{DocumentID: docID, CollectionID: colID, Tenant: in.Tenant})
		if err != nil {
			return listOutput[*chunk.Chunk]{}, deps.mapError(intent, err)
		}
		out := listOutput[*chunk.Chunk]{Items: make([]*chunk.Chunk, 0, len(chunks)), Total: total, Limit: limit, Offset: offset}
		for _, c := range chunks {
			out.Items = append(out.Items, copyChunk(c))
		}
		return out, nil
	}
}

func chunksGetHandler(deps Deps) func(context.Context, idInput, contract.Principal) (chunkDetail, error) {
	return func(ctx context.Context, in idInput, _ contract.Principal) (chunkDetail, error) {
		const intent = "chunks.get"
		chunkID, err := parseChunkID("id", in.ID)
		if err != nil {
			return chunkDetail{}, err
		}
		c, err := deps.Engine.GetChunk(ctx, chunkID)
		if err != nil {
			return chunkDetail{}, deps.mapError(intent, err)
		}
		out := chunkDetail{Chunk: copyChunk(c)}
		if doc, err := deps.Engine.GetDocument(ctx, c.DocumentID); err == nil {
			out.DocumentTitle = doc.Title
		}
		neighbours, err := deps.Engine.ListChunks(ctx, &chunk.ListFilter{DocumentID: c.DocumentID, Offset: max(c.Index-1, 0), Limit: 3})
		if err != nil {
			return chunkDetail{}, deps.mapError(intent, err)
		}
		for _, n := range neighbours {
			switch n.Index {
			case c.Index - 1:
				out.PreviousID = n.ID.String()
			case c.Index + 1:
				out.NextID = n.ID.String()
			}
		}
		return out, nil
	}
}
```

- [ ] **Step 3: Bind, run, commit**

Append to `bindings`:

```go
		query("chunks.list", chunksListHandler(deps)),
		query("chunks.get", chunksGetHandler(deps)),
```

Run: `go test ./extension/contract/ -run TestChunks -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: PASS.

```bash
git add extension/contract/handlers_chunks.go extension/contract/handlers_chunks_test.go
git commit --only -m "feat(contract): page chunks and read one with its neighbours" -- extension/contract/handlers_chunks.go extension/contract/handlers_chunks_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 8: Retrieval

**Files:**
- Create: `extension/contract/handlers_retrieval.go`
- Create: `extension/contract/handlers_retrieval_test.go`
- Modify: `extension/contract/contract.go` (bindings)

**Interfaces:**
- Consumes: Tasks 3-7, engine `RetrieveCompare(ctx, query, engine.CompareParams) (*engine.CompareResult, error)`, `Assemble(ctx, []engine.ScoredChunk, engine.AssembleParams) (*engine.AssembledContext, error)`, `AssembleRefs(ctx, []engine.ChunkRef, engine.AssembleParams) (*engine.AssembledContext, []engine.ScoredChunk, error)`, `Components()`, `Config()`.
- Produces: `maxQueryBytes = 8 << 10`, `maxTopK = 50`, `defaultMaxTokens = 4096`, `maxMaxTokens = 32768`, `maxAssembleRefs = 50`, `type runInput`, `type runOutput struct{ Result *engine.CompareResult "result"; Context *engine.AssembledContext "context" }`, `type assembleInput struct{ Hits []engine.ChunkRef "hits"; MaxTokens int "max_tokens" }`, handlers `retrievalRunHandler`, `retrievalAssembleHandler`.

- [ ] **Step 1: Write the failing tests**

`extension/contract/handlers_retrieval_test.go`:

```go
package contract

import (
	"context"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave"
	"github.com/xraph/weave/chunker"
	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/id"
	"github.com/xraph/weave/store/memory"
)

func TestRetrievalRunAndAssemble(t *testing.T) {
	forEachStore(t, func(t *testing.T, deps Deps) {
		ctx := context.Background()
		p := principal()
		col := mustCollection(t, deps, "kb")
		want := mustIngest(t, ctx, deps, col.ID, "refunds", "refunds are issued within thirty days")
		mustIngest(t, ctx, deps, col.ID, "shipping", "shipping takes five working days")

		out, err := retrievalRunHandler(deps)(ctx, runInput{Query: "refunds thirty days", CollectionID: col.ID.String(), TopK: 2}, p)
		if err != nil {
			t.Fatalf("run: %v", err)
		}
		if len(out.Result.Hits) == 0 || out.Result.Hits[0].Chunk.DocumentID.String() != want.String() || !out.Result.SameSearch {
			t.Fatalf("hits: %+v", out.Result)
		}
		if out.Context == nil || !strings.Contains(out.Context.Context, "refunds are issued") || out.Context.MaxTokens != defaultMaxTokens {
			t.Fatalf("context: %+v", out.Context)
		}

		refs := []engine.ChunkRef{{ChunkID: out.Result.Hits[0].Chunk.ID, Score: out.Result.Hits[0].Score}}
		ac, err := retrievalAssembleHandler(deps)(ctx, assembleInput{Hits: refs, MaxTokens: 5}, p)
		if err != nil || ac.MaxTokens != 5 || ac.FirstExcluded != 0 {
			t.Fatalf("assemble with a tiny budget: %+v %v", ac, err)
		}
	})
}

func TestRetrievalRun_TenantFilter(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	col := mustCollection(t, deps, "kb")
	mustIngest(t, weave.WithTenant(ctx, "t1"), deps, col.ID, "tenanted", "refunds for tenant one")
	open := mustIngest(t, ctx, deps, col.ID, "open", "refunds for nobody in particular")

	empty := ""
	out, err := retrievalRunHandler(deps)(ctx, runInput{Query: "refunds", Tenant: &empty}, principal())
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(out.Result.Hits) != 1 || out.Result.Hits[0].Chunk.DocumentID.String() != open.String() {
		t.Errorf("tenant \"\": %+v", out.Result.Hits)
	}
}

func TestRetrievalRun_Validation(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	cases := map[string]runInput{
		"blank query":    {Query: "   "},
		"huge query":     {Query: strings.Repeat("q", maxQueryBytes+1)},
		"negative top_k": {Query: "x", TopK: -1},
		"negative budget": {Query: "x", MaxTokens: -1},
		"bad collection": {Query: "x", CollectionID: "nope"},
	}
	for name, in := range cases {
		if _, err := retrievalRunHandler(deps)(ctx, in, principal()); codeOf(err) != dashcontract.CodeBadRequest {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := retrievalAssembleHandler(deps)(ctx, assembleInput{Hits: []engine.ChunkRef{{ChunkID: id.NewChunkID()}}}, principal()); codeOf(err) != dashcontract.CodeNotFound {
		t.Errorf("stale ref: %v", err)
	}
	tooMany := make([]engine.ChunkRef, maxAssembleRefs+1)
	if _, err := retrievalAssembleHandler(deps)(ctx, assembleInput{Hits: tooMany}, principal()); codeOf(err) != dashcontract.CodeBadRequest {
		t.Errorf("too many refs: %v", err)
	}
}

// A deployment with no embedder cannot search; the page must say so.
func TestRetrievalRun_NoEmbedderIsUnavailable(t *testing.T) {
	e, err := engine.New(engine.WithStore(memory.New()), engine.WithChunker(chunker.NewRecursiveChunker()))
	if err != nil {
		t.Fatal(err)
	}
	_, err = retrievalRunHandler(Deps{Engine: e})(context.Background(), runInput{Query: "anything"}, principal())
	if codeOf(err) != dashcontract.CodeUnavailable {
		t.Errorf("no embedder: %v", err)
	}
}
```

Run: `go test ./extension/contract/ -run TestRetrieval`
Expected: FAIL to compile, `undefined: retrievalRunHandler`.

- [ ] **Step 2: Write handlers_retrieval.go**

```go
package contract

import (
	"context"
	"errors"
	"strings"

	"github.com/xraph/forge/extensions/dashboard/contract"

	"github.com/xraph/weave"
	"github.com/xraph/weave/engine"
)

const (
	maxQueryBytes    = 8 << 10
	maxTopK          = 50
	defaultMaxTokens = 4096
	maxMaxTokens     = 32768
	maxAssembleRefs  = 50
)

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

type assembleInput struct {
	Hits      []engine.ChunkRef `json:"hits"`
	MaxTokens int               `json:"max_tokens"`
}

func resolveBudget(n int) (int, error) {
	switch {
	case n < 0:
		return 0, badRequest("max_tokens cannot be negative")
	case n == 0:
		return defaultMaxTokens, nil
	case n > maxMaxTokens:
		return maxMaxTokens, nil
	}
	return n, nil
}

func retrievalRunHandler(deps Deps) func(context.Context, runInput, contract.Principal) (runOutput, error) {
	return func(ctx context.Context, in runInput, _ contract.Principal) (runOutput, error) {
		const intent = "retrieval.run"
		query := strings.TrimSpace(in.Query)
		if query == "" {
			return runOutput{}, badRequest("query is empty")
		}
		if len(in.Query) > maxQueryBytes {
			return runOutput{}, badRequest("query is longer than 8 KiB")
		}
		if in.TopK < 0 {
			return runOutput{}, badRequest("top_k cannot be negative")
		}
		topK := in.TopK
		if topK == 0 {
			topK = deps.Engine.Config().DefaultTopK
		}
		topK = min(topK, maxTopK)
		budget, err := resolveBudget(in.MaxTokens)
		if err != nil {
			return runOutput{}, err
		}
		colID, err := optionalCollectionID("collection_id", in.CollectionID)
		if err != nil {
			return runOutput{}, err
		}
		comps := deps.Engine.Components()
		if !comps.Embedder.Configured {
			return runOutput{}, mapError(weave.ErrNoEmbedder)
		}
		if !comps.VectorStore.Configured {
			return runOutput{}, mapError(weave.ErrNoVectorStore)
		}

		res, err := deps.Engine.RetrieveCompare(ctx, query, engine.CompareParams{CollectionID: colID, Tenant: in.Tenant, TopK: topK, MinScore: in.MinScore})
		if err != nil {
			return runOutput{}, deps.mapError(intent, err)
		}
		hits := make([]engine.ScoredChunk, len(res.Hits))
		for i, h := range res.Hits {
			hits[i] = h.ScoredChunk
		}
		ac, err := deps.Engine.Assemble(ctx, hits, engine.AssembleParams{MaxTokens: budget})
		if err != nil {
			return runOutput{}, deps.mapError(intent, err)
		}
		return runOutput{Result: res, Context: ac}, nil
	}
}

// retrievalAssembleHandler re-assembles an earlier ranking with a new
// budget. It reads each chunk back by ID and never embeds again. A chunk
// that has gone means the ranking is stale.
func retrievalAssembleHandler(deps Deps) func(context.Context, assembleInput, contract.Principal) (*engine.AssembledContext, error) {
	return func(ctx context.Context, in assembleInput, _ contract.Principal) (*engine.AssembledContext, error) {
		if len(in.Hits) > maxAssembleRefs {
			return nil, badRequest("at most 50 hits can be assembled at once")
		}
		budget, err := resolveBudget(in.MaxTokens)
		if err != nil {
			return nil, err
		}
		ac, _, err := deps.Engine.AssembleRefs(ctx, in.Hits, engine.AssembleParams{MaxTokens: budget})
		if errors.Is(err, weave.ErrChunkNotFound) {
			return nil, notFound("a chunk in this ranking no longer exists; run the query again")
		}
		if err != nil {
			return nil, deps.mapError("retrieval.assemble", err)
		}
		return ac, nil
	}
}
```

- [ ] **Step 3: Bind, run, commit**

Append to `bindings`:

```go
		command("retrieval.run", retrievalRunHandler(deps)),
		command("retrieval.assemble", retrievalAssembleHandler(deps)),
```

Run: `go test ./extension/contract/ -run TestRetrieval -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: PASS.

```bash
git add extension/contract/handlers_retrieval.go extension/contract/handlers_retrieval_test.go
git commit --only -m "feat(contract): run a query side by side and re-assemble its context" -- extension/contract/handlers_retrieval.go extension/contract/handlers_retrieval_test.go extension/contract/contract.go
git show --stat HEAD
```

---

### Task 9: Cross-cutting guarantees

**Files:**
- Create: `extension/contract/bindings_test.go`
- Create: `extension/contract/transport_test.go`
- Create: `extension/contract/novectors_test.go`

**Interfaces:**
- Consumes: everything above; forge `transport.NewHandler(reg, wreg, d, nil)`, `dashcontract.NewRegistry()`, `dashcontract.NewWardenRegistry()`, `dispatcher.New(nil)`, `dashcontract.Response`.

- [ ] **Step 1: Every declared intent is bound, once**

`extension/contract/bindings_test.go`:

```go
package contract

import (
	"sort"
	"testing"
)

// Register refuses a handler the manifest does not declare; this closes the
// other direction, so a declared intent never answers "no handler".
func TestEveryDeclaredIntentIsBound(t *testing.T) {
	bound := map[string]bool{}
	for _, b := range bindings(newDeps(t, openMemory(t))) {
		if bound[b.intent] {
			t.Errorf("%s is bound twice", b.intent)
		}
		bound[b.intent] = true
	}
	var missing []string
	for _, in := range loadManifest(t).Intents {
		if !bound[in.Name] {
			missing = append(missing, in.Name)
		}
	}
	sort.Strings(missing)
	if len(missing) > 0 {
		t.Fatalf("declared but not bound: %v", missing)
	}
}
```

- [ ] **Step 2: Invalidates reach the client over real HTTP**

`extension/contract/transport_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"
	"github.com/xraph/forge/extensions/dashboard/contract/transport"
)

// serve registers the contract on fresh registries and returns a function
// that posts one envelope through forge's real HTTP transport.
func serve(t *testing.T, deps Deps) func(kind, intent, payload string) dashcontract.Response {
	t.Helper()
	reg := dashcontract.NewRegistry()
	wreg := dashcontract.NewWardenRegistry()
	d := dispatcher.New(nil)
	if err := Register(d, reg, wreg, deps); err != nil {
		t.Fatalf("Register: %v", err)
	}
	h := transport.NewHandler(reg, wreg, d, nil)
	n := 0
	return func(kind, intent, payload string) dashcontract.Response {
		n++
		body := `{"envelope":"v1","kind":"` + kind + `","contributor":"weave","intent":"` + intent + `",` +
			`"csrf":"test","idempotencyKey":"test-` + intent + `-` + strings.Repeat("x", n) + `","payload":` + payload + `}`
		req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/dashboard/v1", strings.NewReader(body))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var resp dashcontract.Response
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode %s: %v (%s)", intent, err, rec.Body)
		}
		return resp
	}
}

func TestCommandInvalidatesReachTheClient(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	post := serve(t, deps)

	created := post("command", "collections.create", `{"name":"kb"}`)
	if !created.OK {
		t.Fatalf("create failed: %s", created.Data)
	}
	want := map[string][]string{}
	for _, in := range loadManifest(t).Intents {
		want[in.Name] = in.Invalidates
	}
	if !reflect.DeepEqual(created.Meta.Invalidates, want["collections.create"]) {
		t.Fatalf("create invalidates = %v, want %v", created.Meta.Invalidates, want["collections.create"])
	}

	var row struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(created.Data, &row); err != nil || row.ID == "" {
		t.Fatalf("created row: %s %v", created.Data, err)
	}
	ingested := post("command", "documents.ingest", `{"collection_id":"`+row.ID+`","title":"refunds","content":"refunds are issued within thirty days"}`)
	if !ingested.OK || !reflect.DeepEqual(ingested.Meta.Invalidates, want["documents.ingest"]) {
		t.Fatalf("ingest: ok=%v invalidates=%v (%s)", ingested.OK, ingested.Meta.Invalidates, ingested.Data)
	}

	listed := post("query", "documents.list", `{"collection_id":"`+row.ID+`"}`)
	if !listed.OK || !strings.Contains(string(listed.Data), `"collection_name":"kb"`) {
		t.Fatalf("list: %s", listed.Data)
	}
}
```

- [ ] **Step 3: No response carries a vector**

`extension/contract/novectors_test.go`:

```go
package contract

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/xraph/weave/engine"
)

// assertNoVectors fails if any key anywhere in v's JSON names a vector or
// an embedding. Embeddings are large and never leave the server.
func assertNoVectors(t *testing.T, label string, v any) {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("%s: marshal: %v", label, err)
	}
	var walk func(path string, x any)
	walk = func(path string, x any) {
		switch val := x.(type) {
		case map[string]any:
			for k, child := range val {
				switch strings.ToLower(k) {
				case "vector", "vectors", "embedding", "embeddings":
					t.Errorf("%s: key %q at %s", label, k, path)
				}
				walk(path+"."+k, child)
			}
		case []any:
			for _, child := range val {
				walk(path+"[]", child)
			}
		}
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("%s: decode: %v", label, err)
	}
	walk(label, decoded)
}

// TestNoResponseCarriesAVector calls every handler that returns data, on a
// populated engine, and walks each answer.
func TestNoResponseCarriesAVector(t *testing.T) {
	deps := newDeps(t, openMemory(t))
	ctx := context.Background()
	p := principal()
	col := mustCollection(t, deps, "kb")
	doc := mustIngest(t, ctx, deps, col.ID, "refunds", "refunds are issued within thirty days")
	mustIngest(t, ctx, deps, col.ID, "shipping", "shipping takes five working days")

	check := func(label string, v any, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		assertNoVectors(t, label, v)
	}

	ov, err := systemOverviewHandler(deps)(ctx, tenantInput{}, p)
	check("system.overview", ov, err)
	comps, err := systemComponentsHandler(deps)(ctx, struct{}{}, p)
	check("system.components", comps, err)
	cl, err := collectionsListHandler(deps)(ctx, collectionsListInput{}, p)
	check("collections.list", cl, err)
	cg, err := collectionsGetHandler(deps)(ctx, idInput{ID: col.ID.String()}, p)
	check("collections.get", cg, err)
	dl, err := documentsListHandler(deps)(ctx, documentsListInput{}, p)
	check("documents.list", dl, err)
	dg, err := documentsGetHandler(deps)(ctx, idInput{ID: doc.String()}, p)
	check("documents.get", dg, err)
	ds, err := documentsSpansHandler(deps)(ctx, idInput{ID: doc.String()}, p)
	check("documents.spans", ds, err)
	chl, err := chunksListHandler(deps)(ctx, chunksListInput{DocumentID: doc.String()}, p)
	check("chunks.list", chl, err)
	chg, err := chunksGetHandler(deps)(ctx, idInput{ID: chl.Items[0].ID.String()}, p)
	check("chunks.get", chg, err)
	run, err := retrievalRunHandler(deps)(ctx, runInput{Query: "refunds"}, p)
	check("retrieval.run", run, err)
	refs := []engine.ChunkRef{{ChunkID: run.Result.Hits[0].Chunk.ID, Score: run.Result.Hits[0].Score}}
	ac, err := retrievalAssembleHandler(deps)(ctx, assembleInput{Hits: refs}, p)
	check("retrieval.assemble", ac, err)
}
```

- [ ] **Step 4: Run all three, then commit**

Run: `go test ./extension/contract/ -run 'TestEveryDeclaredIntentIsBound|TestCommandInvalidatesReachTheClient|TestNoResponseCarriesAVector' -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: PASS. If the transport answers `ok: false` for a missing CSRF or idempotency check in this forge version, read `transport/http.go` in forge v1.12.0 for what the envelope needs and adjust `serve`, not the assertions.

```bash
git add extension/contract/bindings_test.go extension/contract/transport_test.go extension/contract/novectors_test.go
git commit --only -m "test(contract): bind every intent, carry invalidates, never send a vector" -- extension/contract/bindings_test.go extension/contract/transport_test.go extension/contract/novectors_test.go
git show --stat HEAD
```

---

### Task 10: Register from the extension and hand the engine its config

**Files:**
- Create: `extension/dashboard_contract.go`
- Create: `extension/dashboard_contract_test.go`
- Create: `extension/config_test.go`
- Modify: `extension/config.go` (`engineConfig`)
- Modify: `extension/extension.go` (`Register`: prepend `engine.WithConfig`)

**Interfaces:**
- Consumes: `contract.Register`, `contract.Deps`, `engine.WithConfig`.
- Produces: `(*Extension).RegisterContractContributor(disp *dispatcher.Dispatcher, reg dashcontract.Registry, wreg dashcontract.WardenRegistry) error`, `(Config).engineConfig() weave.Config`.

- [ ] **Step 1: Write the failing tests**

`extension/config_test.go`:

```go
package extension

import (
	"testing"
	"time"

	"github.com/xraph/weave"
)

func TestEngineConfig_DefaultsWhenUnset(t *testing.T) {
	if got := (Config{}).engineConfig(); got != weave.DefaultConfig() {
		t.Errorf("zero Config: %+v, want weave.DefaultConfig()", got)
	}
}

// Before this, the YAML defaults never reached the engine.
func TestEngineConfig_PassesSettingsThrough(t *testing.T) {
	got := Config{
		DefaultChunkSize: 300, DefaultChunkOverlap: 30, DefaultEmbeddingModel: "m",
		DefaultChunkStrategy: "fixed", DefaultTopK: 7, ShutdownTimeout: 5 * time.Second, IngestConcurrency: 2,
	}.engineConfig()
	want := weave.Config{
		DefaultChunkSize: 300, DefaultChunkOverlap: 30, DefaultEmbeddingModel: "m",
		DefaultChunkStrategy: "fixed", DefaultTopK: 7, ShutdownTimeout: 5 * time.Second, IngestConcurrency: 2,
	}
	if got != want {
		t.Errorf("got %+v, want %+v", got, want)
	}
}
```

`extension/dashboard_contract_test.go`:

```go
package extension

import (
	"testing"

	dashboard "github.com/xraph/forge/extensions/dashboard"
	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	"github.com/xraph/weave/engine"
	"github.com/xraph/weave/store/memory"
)

// The dashboard finds contract contributors by type assertion at runtime,
// so production code never imports forge's dashboard root. This keeps the
// method checked against the real interface anyway.
var _ dashboard.ContractContributorAware = (*Extension)(nil)

func TestRegisterContractContributor(t *testing.T) {
	e := New()
	eng, err := engine.New(engine.WithStore(memory.New()))
	if err != nil {
		t.Fatal(err)
	}
	e.eng = eng

	reg := dashcontract.NewRegistry()
	if err := e.RegisterContractContributor(dispatcher.New(nil), reg, dashcontract.NewWardenRegistry()); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, ok := reg.Contributor("weave"); !ok {
		t.Fatal("weave contributor not registered")
	}
}

// Before Register runs there is no engine; the dashboard's discovery must
// not fail the whole app over it.
func TestRegisterContractContributor_NoEngine(t *testing.T) {
	reg := dashcontract.NewRegistry()
	if err := New().RegisterContractContributor(dispatcher.New(nil), reg, dashcontract.NewWardenRegistry()); err != nil {
		t.Fatalf("register: %v", err)
	}
	if _, ok := reg.Contributor("weave"); ok {
		t.Fatal("registered without an engine")
	}
}
```

Run: `go test ./extension/ -run 'TestEngineConfig|TestRegisterContractContributor'`
Expected: FAIL to compile, `e.engineConfig undefined`, `RegisterContractContributor undefined`.

- [ ] **Step 2: Add engineConfig**

Append to `extension/config.go` (add `"github.com/xraph/weave"` to its imports):

```go
// engineConfig is the part of the extension's configuration the engine
// reads. Unset fields keep the engine's own defaults. Before this, the YAML
// defaults never reached the engine.
func (c Config) engineConfig() weave.Config {
	cfg := weave.DefaultConfig()
	if c.DefaultChunkSize > 0 {
		cfg.DefaultChunkSize = c.DefaultChunkSize
	}
	if c.DefaultChunkOverlap > 0 {
		cfg.DefaultChunkOverlap = c.DefaultChunkOverlap
	}
	if c.DefaultEmbeddingModel != "" {
		cfg.DefaultEmbeddingModel = c.DefaultEmbeddingModel
	}
	if c.DefaultChunkStrategy != "" {
		cfg.DefaultChunkStrategy = c.DefaultChunkStrategy
	}
	if c.DefaultTopK > 0 {
		cfg.DefaultTopK = c.DefaultTopK
	}
	if c.ShutdownTimeout > 0 {
		cfg.ShutdownTimeout = c.ShutdownTimeout
	}
	if c.IngestConcurrency > 0 {
		cfg.IngestConcurrency = c.IngestConcurrency
	}
	return cfg
}
```

- [ ] **Step 3: Pass it to the engine**

In `extension/extension.go` `Register`, replace:

```go
	eng, err := engine.New(e.engineOpts...)
```

with:

```go
	// The config goes first so an engine option the caller passed with
	// WithEngineOption still wins.
	opts := append([]engine.Option{engine.WithConfig(e.config.engineConfig())}, e.engineOpts...)
	eng, err := engine.New(opts...)
```

- [ ] **Step 4: Register the contributor**

`extension/dashboard_contract.go`:

```go
package extension

import (
	"fmt"

	dashcontract "github.com/xraph/forge/extensions/dashboard/contract"
	"github.com/xraph/forge/extensions/dashboard/contract/dispatcher"

	weavecontract "github.com/xraph/weave/extension/contract"
)

// RegisterContractContributor registers the weave contract contributor,
// which is what the React dashboard reads. Forge's dashboard discovers it by
// type assertion during Start.
func (e *Extension) RegisterContractContributor(
	disp *dispatcher.Dispatcher,
	reg dashcontract.Registry,
	wreg dashcontract.WardenRegistry,
) error {
	if e.eng == nil {
		if logger := e.Logger(); logger != nil {
			logger.Warn("weave: not initialised; skipping contract contributor registration")
		}
		return nil
	}
	deps := weavecontract.Deps{Engine: e.eng}
	if logger := e.Logger(); logger != nil {
		deps.Logger = logger
	}
	if err := weavecontract.Register(disp, reg, wreg, deps); err != nil {
		return fmt.Errorf("weave: register contract contributor: %w", err)
	}
	return nil
}
```

If `e.Logger()` panics on an extension that never ran `Register` (the second test exercises this), read `forge.BaseExtension.Logger` and guard accordingly; keep the behaviour "log if there is a logger, never fail".

- [ ] **Step 5: Run, check the import rule, commit**

Run: `go test ./extension/... -count=1 -v 2>&1 | grep -E '^(\s*--- |ok|FAIL)'`
Expected: all PASS.

Check no production file imports forge's dashboard root:

```bash
grep -rln '"github.com/xraph/forge/extensions/dashboard"' --include='*.go' . | grep -v '_test.go$' | grep -v '^./_project_files/'
```

Expected: no output.

```bash
git add extension/dashboard_contract.go extension/dashboard_contract_test.go extension/config_test.go
git commit --only -m "feat(extension): register the weave contract and hand the engine its config" -- extension/dashboard_contract.go extension/dashboard_contract_test.go extension/config_test.go extension/config.go extension/extension.go
git show --stat HEAD
```

---

### Task 11: Gate the slice and hand the wire to slice 2

**Files:**
- Modify: `docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md` in the forge-dashboard repo

- [ ] **Step 1: Whole-module gate**

With the test databases running and both DSNs exported: `go build ./... && go vet ./... && go test -count=1 ./...` (all `ok`, store conformance 0 SKIP), `gofmt -l .` empty, and lint with a fresh cache at `0 issues.` Fix any lint in this slice's files with the smallest change, committed as `chore: clear the lint the contract slice left behind` with only those files.

- [ ] **Step 2: Record the wire for slice 2**

Invoke `rex-voice`, draft, run through `humanizer` in embedded mode. No em or en dashes (grep before committing). Append `## What slice 3 found that slice 2 must know` to the spec with:

- for each of the 17 intents: its input struct and output struct with json tags copied verbatim from `extension/contract/*.go` (expand embedded structs: `page` adds `limit` and `offset`; `collectionRow` is a `collection.Collection` plus live `document_count` and `chunk_count`; `documentRow` is a `document.Document` plus `collection_name` and `stalled`; `listOutput` is `items`, `total`, `limit`, `offset`);
- the error code each intent can answer and when;
- defaults and caps: limit 25 (max 100), top_k engine default (max 50), max_tokens 4096 (max 32768), query 8 KiB, ingest 1 MiB, spans 5000, assemble 50 refs;
- that an overlap of 0 on create means "the default" (the engine treats 0 that way), so the form cannot set overlap to 0;
- that `documents.ingest` answers `state: failed` with `error` for a failed ingest, and `CONFLICT` for a duplicate;
- that lists are newest first;
- the forge version (v1.12.0) and that templ is gone from Weave, with the `MIGRATION.md` commit and the deletion commit;
- the slice's commit hashes.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard && git commit --only -m "docs: record the weave contract slice 2 builds on" -- docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md && git show --stat HEAD
```
