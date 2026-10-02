# Warden relation graphs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw warden's relationship model as graphs an operator can trust: the schema graph of resource types and their relations, safe to draw whole, and an instance graph of relation tuples rooted at one object and expanded by the engine's own walk and budget, which says plainly where and why it stopped.

**Architecture:** Core extracts the BFS from the ReBAC graph walker into one traversal that both `Check`'s walker and a new `Engine.ExpandRelation` use, so the instance graph is the engine's walk with the target removed, not a reconstruction. Two contract intents, `resourceTypes.graph` and `relations.expand`, project the schema and the expansion. React Flow with a dagre layout renders both, in lazy chunks. The playground links a ReBAC allow to the graph with the engine's path highlighted. The bundle is re-measured into `BASELINE.md`.

**Tech Stack:** Go 1.26, React 19.2, `@xyflow/react` 12, `@dagrejs/dagre`, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, "The two heavy surfaces" ("The relations graph") and the sequence's slices 14 and 16.

**Predecessors:** plans through `2026-09-30-warden-schema.md`. This plan assumes the contract's guards, `tenantFrom`, `principalHolds`, the plugin package, the playground's lanes (`components/playground-lanes.tsx`), and the resource types and relations pages.

## Global Constraints

- Contributor name is exactly `warden`. DTOs are camelCase; arrays never `null`.
- Every handler resolves its tenant with `tenantFrom(p, deps)`; engine calls pass it with `warden.WithCallTenantID`.
- Every new handler is added to **three** self-checking guards. Extend them; never loosen an assertion. An intent that reads several entities' data checks each grant (`principalHolds`).
- `Check`'s observable behaviour does not change; every existing root-package test passes unmodified.
- **Every sentence a page shows must be true for every case it can appear in.** Verify against `graph_walker.go`, `engine.go` and the store, never against a comment.
- React Flow and dagre load lazily: nothing from `@xyflow/*` or `@dagrejs/*` may enter the shell's entry chunk. Measure it.
- React tests use `fireEvent`, `toBeTruthy()` and `.textContent`; failure tests stub a thrown `ContractError`.
- No em dashes anywhere. No `Co-Authored-By` trailers, no Claude or Anthropic attribution.
- Both trees are shared with live sessions. Commit by explicit path, paths inline; stage new files with `git add <path>`; never `git add -A`, `git commit -a` or `--amend`; verify by SHA; restore only from your own backup or `git checkout -- <exact path>`; delete only files you created, by exact name; never touch local port 5432. **`pnpm-lock.yaml`** is edited by other sessions too: commit only this plan's hunks through a private `GIT_INDEX_FILE`, `commit-tree` and a compare-and-swap `update-ref refs/heads/main NEW OLD`, then re-point the shared index entry with `git update-index --cacheinfo` so the commit is not staged as reverted; stop and report if a hunk mixes sessions' lines.

## What the engine actually does

Verified against `warden/graph_walker.go` and the stores.

- **The walk** (`bfsGraphWalker.Walk`): BFS from `(resource.type, resource.id, action)` as `(objectType, objectID, relation)`. At each node it calls `ListRelationSubjects(tenant, AncestorNamespaces(ns), type, id, relation, maxFanout)`; relations cascade from ancestor namespaces. A tuple whose subject matches the check's subject ends the walk. A tuple with a `SubjectRelation` (a subject set such as `group:eng#member`) enqueues `(subjectType, subjectID, subjectRelation)` at depth + 1; a tuple naming a single subject is never expanded.
- **Relations match exactly**: the store compares `relation` with `==`; there is no "every relation" query.
- **The budget**, from `Config`: `MaxGraphDepth` (default 10) aborts with `ErrGraphDepthExceeded` when a dequeued node's depth exceeds it; `MaxGraphVisited` (default 5000) aborts with `ErrGraphBudgetExceeded` when distinct `type:id#relation` nodes exceed it; `MaxGraphFanout` (default 1000) is both the per-hop fetch limit and an abort with `ErrGraphBudgetExceeded` when a hop returns **at least** that many tuples.
- **The path** `reconstructPath` returns is `type:id#relation -> ... -> subjectType:subjectID`, the first match in BFS order; the playground's ReBAC lane shows it as `transitive: <path>`.
- **What the walk does not see**: resource-type permission expressions (`viewer or editor or parent->read`), which `evaluateReBAC` evaluates separately through the expression evaluator before the walk, and direct relations, which `CheckDirectRelation` answers first.

## Deviations from the spec

1. **The instance graph is the engine's walk, exported.** The spec says to expand "using the engine's own budget". Rather than a second BFS with borrowed numbers, core extracts the walker's traversal so `ExpandRelation` and `Walk` run the same code: the same order, the same budget, the same stop conditions. A highlighted trail is then the path the engine would find, by construction.
2. **A graph is rooted at an object and one relation**, because the store matches relations exactly; the page offers the relations the object's resource type declares.
3. **Expressions are not drawn as edges.** The schema graph annotates each type with its permission expressions as text; the instance graph says it shows tuples only, since expressions are evaluated outside the walk.

## Review Focus

1. **A truncated graph read as complete.** Every stop (depth, visited, fanout) is named with the engine's limit; an unstopped expansion says it reached every tuple. Tasks 1, 2 and 5.
2. **The walk and the expansion drifting.** Task 1's equivalence test runs `Walk` and `ExpandRelation` on the same seeds and asserts the walker's path is the expansion's path to that subject.
3. **A page hang on a large tenant.** The schema graph is bounded by the number of resource types (capped, with a flag); the instance graph by the engine's budget.
4. **A highlighted trail that is not the engine's.** Task 5 highlights only the path `ExpandRelation` reports, never one the page infers.
5. **The bundle.** Task 6 measures and records it.

---

## Task 1: Share the walker's traversal and add `Engine.ExpandRelation`

**Files:** `graph_walker.go` (modify), `expand.go` (create), `expand_test.go` (create), `engine.go` (the accessor only).

**Interfaces:**

```go
// ExpandStop says why an expansion ended.
type ExpandStop string

const (
	ExpandComplete ExpandStop = "complete"  // every reachable tuple was visited
	ExpandDepth    ExpandStop = "depth"     // a node beyond MaxGraphDepth was reached
	ExpandVisited  ExpandStop = "visited"   // more than MaxGraphVisited distinct nodes
	ExpandFanout   ExpandStop = "fanout"    // one hop returned at least MaxGraphFanout tuples
)

// ExpandNode is one (objectType, objectID, relation) the walk visited, or a
// single subject it reached.
type ExpandNode struct {
	Type, ID, Relation string // Relation is "" for a single subject
	Depth              int
}

// ExpandEdge is one tuple: from the object node to its subject node.
type ExpandEdge struct {
	From, To      int // indexes into Nodes
	NamespacePath string
}

// Expansion is the walk Check would perform from one object and relation,
// with no target subject, so it visits everything reachable within the
// engine's budget.
type Expansion struct {
	Nodes []ExpandNode
	Edges []ExpandEdge
	Stop  ExpandStop
	// Limit is the configured value of the limit named by Stop; 0 for
	// ExpandComplete.
	Limit int
	// Parent maps a node index to the node it was first reached from (-1
	// for the root), in the walker's BFS order, so PathTo reproduces the
	// path Walk would report.
	Parent []int
}

// PathTo returns the walk's path from the root to the first node for
// subjectType:subjectID, formatted exactly as the walker's reconstructPath,
// or "" when the expansion never reached it.
func (x *Expansion) PathTo(subjectType, subjectID string) string

// ExpandRelation walks the relation graph from objectType:objectID#relation
// as Check's walker does, without a target, using the configured graph
// budget and the call's tenant and namespace (relations cascade from
// ancestors). It writes nothing.
func (e *Engine) ExpandRelation(ctx context.Context, objectType, objectID, relation string, opts ...CallOption) (*Expansion, error)
```

- [ ] **Step 1: Write the failing tests** (`expand_test.go`, package `warden`, memory store): a two-hop userset chain expands to the expected nodes and edges with `Stop` `complete`; a chain deeper than a configured `MaxGraphDepth` stops `depth` with `Limit` equal to it; more distinct nodes than `MaxGraphVisited` stops `visited`; a hop with exactly `MaxGraphFanout` tuples stops `fanout` (the walker's `>=` rule); tuples at an ancestor namespace are included and a sibling's are not; **equivalence**: for a table of seeds, `Walk` for subject S returns path P, and `ExpandRelation(...).PathTo(S)` returns P exactly; and when `Walk` returns `ErrGraphDepthExceeded` or `ErrGraphBudgetExceeded`, the expansion stops with the matching reason. Every existing walker and engine test passes unmodified.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Extract the traversal.** Move the BFS loop into one private function with a visitor callback that the walker uses to stop on a target match and the expansion uses to record nodes and edges; keep the walker's metrics calls and errors exactly. Move code; do not rewrite it.
- [ ] **Step 4: Run with `-race`**, then `go build ./... && go test ./...`. Mutate once (make the expansion's fanout check `>` instead of `>=`), confirm the fanout test fails, restore.
- [ ] **Step 5: Commit** by path: `feat(engine): expand a relation as the graph walker walks it`.

---

## Task 2: `resourceTypes.graph` and `relations.expand`

**Files:** `extension/contract/handlers_graphs.go` (create), its test, registration and the three guards.

**Interfaces:**

```go
type ResourceTypeGraphInput struct {
	NamespacePath *string `json:"namespacePath,omitempty"`
}

type ResourceTypeGraphNode struct {
	ID            string             `json:"id"`
	NamespacePath string             `json:"namespacePath"`
	Name          string             `json:"name"`
	Relations     []RelationDefDTO   `json:"relations"`   // existing DTO
	Permissions   []PermissionDefDTO `json:"permissions"` // existing DTO
}

type ResourceTypeGraphEdge struct {
	From     string `json:"from"`     // resource type name
	Relation string `json:"relation"` // the RelationDef's name
	To       string `json:"to"`       // allowed subject type
	// ToRelation is the subject set's relation for "type#rel", else "".
	ToRelation string `json:"toRelation,omitempty"`
	// Declared is false when To names no resource type in the graph (a
	// subject kind like "user", or a type outside the namespace filter).
	Declared bool `json:"declared"`
}

type ResourceTypeGraphResponse struct {
	Nodes     []ResourceTypeGraphNode `json:"nodes"`
	Edges     []ResourceTypeGraphEdge `json:"edges"`
	Truncated bool                    `json:"truncated"` // more than 500 types
}

type RelationExpandInput struct {
	ObjectType    string `json:"objectType"`
	ObjectID      string `json:"objectId"`
	Relation      string `json:"relation"`
	NamespacePath string `json:"namespacePath"` // "" is the root
	// PathToType and PathToID, when both set, ask for the walk's path to
	// that subject.
	PathToType string `json:"pathToType,omitempty"`
	PathToID   string `json:"pathToId,omitempty"`
}

type RelationExpandNode struct {
	Key      string `json:"key"`      // "type:id#relation" or "type:id"
	Type     string `json:"type"`
	ID       string `json:"id"`
	Relation string `json:"relation,omitempty"`
	Depth    int    `json:"depth"`
}

type RelationExpandEdge struct {
	From          string `json:"from"` // node keys
	To            string `json:"to"`
	NamespacePath string `json:"namespacePath"`
}

type RelationExpandResponse struct {
	Nodes []RelationExpandNode `json:"nodes"`
	Edges []RelationExpandEdge `json:"edges"`
	Stop  string               `json:"stop"`  // complete | depth | visited | fanout
	Limit int                  `json:"limit"` // the engine's configured limit, 0 when complete
	// Path is the node keys of the walk's path to PathTo, root first, or
	// empty when not asked for or not reached.
	Path []string `json:"path"`
}
```

- [ ] **Step 1: Tests:** schema graph edges for plain and `#rel` allowed subjects, `declared` true and false, namespace filter, the 500 cap; expansion projection, every stop reason with the configured limit, `path` matching `PathTo`, refusals (`objectType`, `objectId`, `relation` required, invalid namespace); grants (`read warden:resourcetype` for the schema graph; `read warden:relation` for the expansion) and tenant isolation.
- [ ] **Step 2: Implement**, register both as queries (`staleTime` 30s for the schema graph, 0s for the expansion), authz entries, the three guards.
- [ ] **Step 3: Run, mutate once (drop the namespace from the expansion's call options; the ancestor test must fail), commit** by path: `feat(contract): serve the schema graph and a rooted relation expansion`.

---

## Task 3: Fixture

**Files:** `packages/fixture-server/warden-fixtures.mjs`.

- [ ] Mirror both intents from the seed: the schema graph from seeded resource types; the expansion as a BFS over seeded tuples following subject sets only, with relations matched exactly, ancestor namespaces included, and the stop rules and `>=` fanout of Task 1 driven by the fixture's `warden.config` graph limits. Seed a chain at least three hops deep so every state is reachable by changing the config's limits in the file, and document which request reaches each state. Hand-check against the Go handlers on a free port; stop the server by PID. Commit by path: `feat(fixture): serve the warden schema graph and relation expansion`.

---

## Task 4: The schema graph

**Files:** `packages/plugin-warden/src/components/graph-canvas.tsx` (create: React Flow plus dagre layout, the kit's theme tokens), `src/components/schema-graph.tsx` (create), `src/pages/resource-types.tsx` (modify), tests, `package.json`.

- [ ] **Step 1: Dependencies.** Add `@xyflow/react` and `@dagrejs/dagre` to `dependencies`; lockfile per the Global Constraints rule.
- [ ] **Step 2: Tests:** `/resource-types` opens on the graph (the spec makes it the default) with a "Graph" / "Table" switch, the table being today's list; each type is a node showing its name, namespace (root as `/`) and permission expressions as mono text; each relation an edge labelled with its name (and `#rel` for a subject set); an edge to an undeclared type ends at a muted node labelled with the type and "not a resource type"; a truncated response says "Showing the first 500 resource types."; clicking a node opens `/resource-types/<id>`; the empty state says "No resource types yet."
- [ ] **Step 3: Implement** the canvas as a lazily imported component (`lazy(() => import(...))` inside the page), the layout computed with dagre top to bottom. In jsdom, React Flow needs a `ResizeObserver` stub; add it in the test setup only.
- [ ] **Step 4: Verify** test, typecheck, lint; confirm with a shell `vite build` that `@xyflow` lands in a lazy chunk (the shell's `tsc -b` may fail on another session's files; run `vite build` alone and say so). Commit by path: `feat(warden): draw the resource type schema as a graph`.

---

## Task 5: The instance graph and the playground trail

**Files:** `src/components/relation-graph.tsx` (create), `src/pages/relation-graph.tsx` (create), `src/pages/relations.tsx`, `src/components/playground-lanes.tsx`, `src/index.tsx`, tests.

- [ ] **Step 1: Routes.** `/relations/graph/:objectType/:objectId/:relation` (rooted view; namespace control on the page, default root) and `/relations/graph/:objectType/:objectId/:relation/to/:subjectType/:subjectId` (the same, asking for the path). No nav entries; `/relations` gains a "Graph" action per tuple that opens the rooted view at that tuple's object and relation, and a form to pick an object, a relation from its type's declared relations, and a namespace.
- [ ] **Step 2: Tests and sentences**, each exact:
  - complete: "Every tuple reachable from {root} is shown."
  - depth: "Stopped at depth {limit}, the engine's limit. Relations beyond it are not shown."
  - visited: "Stopped after {limit} nodes, the engine's limit. More may be reachable."
  - fanout: "Stopped where one relation has {limit} or more tuples, the engine's limit. The walk ends there, so what it had not yet reached is not shown."
  - always: "Tuples only. Permissions defined by a resource type's expression are evaluated outside this walk."
  - a path asked for and found: the path's nodes and edges are highlighted and listed under "The engine's walk reaches {subject} this way:" as the keys joined by " then "; asked for and not found: "The walk did not reach {subject} within these limits." (true for every stop, since a complete expansion that misses it also did not reach it).
  - Nodes for subject sets show `type:id#relation`; single subjects `type:id`; the root is marked.
- [ ] **Step 3: The playground link.** In `playground-lanes.tsx`, a ReBAC `allow` lane whose matched detail starts with `transitive: ` gains "Show this walk in the graph", linking to the path route with the check's resource type, resource id, action as relation, and subject; test it is absent for `direct relation` and `expression:` details.
- [ ] **Step 4: Verify and commit** by path: `feat(warden): draw a relation walk from one object, within the engine's budget`.

---

## Task 6: Re-measure the bundle

**Files:** `BASELINE.md` (modify).

- [ ] Build the shell (`vite build`, noting if `tsc -b` fails on another session's files), list every emitted JS chunk with raw and gzip sizes in the file's existing table format, mark which load eagerly from the entry and which lazily, and record for each heavy surface (CodeMirror from plan 5a, React Flow and dagre from this plan) which chunk holds it and that the entry chunk does not import it statically (grep the entry for `EditorView` and `ReactFlow`). Write the numbers and the date as a new section; do not rewrite earlier sections. Commit by path: `docs: re-measure the shell bundle after the warden editor and graphs`.

---

## Carried forward

- **To plan 6:** `warden/MIGRATION.md`, the `plugin-authsome` retitle, and the templ deletion as its own commit.
