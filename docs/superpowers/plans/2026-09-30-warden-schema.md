# Warden schema editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator read the tenant's authorization model as Warden DSL source, edit it, see exactly what an apply would change, and apply it, with prune behind its own confirmation and no way to apply text whose diff they have not seen.

**Architecture:** Three contract intents wrap warden's own `dsl` package: `schema.export` (`BuildProgram` then `Format`), `schema.plan` (`Parse`, `Resolve`, `Apply` with `DryRun`) and `schema.apply` (the same, for real). Apply carries the digest of the plan the operator saw and is refused when a fresh dry run no longer matches it. The page is a lazy route at `/schema` with a CodeMirror 6 editor, a Warden `StreamLanguage`, and plan diagnostics as inline lint markers.

**Tech Stack:** Go 1.26, `github.com/xraph/forge v1.10.0`, React 19.2, CodeMirror 6 (`@codemirror/state`, `view`, `language`, `commands`, `search`, `lint`), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-09-23-warden-dashboard-migration-design.md`, "The two heavy surfaces" and its subsection "The DSL surface, at `/schema`".

**Predecessors:** plans through `2026-09-30-warden-subject-view.md`. This plan assumes the contract's guards, `tenantFrom`, `withActor`, `emitAudit`, `principalHolds` (the grant helper `Authorize` and `subjects.detail` share), and the plugin package.

**Scope note:** the spec's plan 5 was two heavy surfaces. It is split. This is 5a, the DSL surface. Plan 5b is the React Flow schema and instance graphs plus the bundle re-measure.

## Global Constraints

- Contributor name is exactly `warden`. DTOs are camelCase; arrays never `null`.
- Every handler resolves its tenant with `tenantFrom(p, deps)`. The tenant passed to `dsl.Apply` is always that tenant, never the source's.
- Every new handler is added to **three** self-checking guards (`handlers_tenant_test.go`, `manifest_test.go`'s `wantKind`, `authz.go`'s `intentPolicies` with `authz_test.go`'s `wantPolicies`). Extend them; never loosen an assertion.
- **An intent that reads or writes several entities' data checks every one of their grants.** The authorizer enforces one pair per intent; the handler checks the rest with `principalHolds` and refuses with `PERMISSION_DENIED` naming the first missing grant. (Plan 4b's final review found `subjects.detail` leaking data under one grant.)
- Every manifest intent line carries `requires: { warden: warden.engine }`; every command declares `invalidates`.
- **Every sentence a page shows must be true for every case it can appear in.** Verify against `dsl/applier.go`, `dsl/parser.go`, `dsl/exporter.go` and `engine.go`, never against a comment.
- React tests use `fireEvent`, `toBeTruthy()` and `.textContent`; failure tests stub a thrown `ContractError`. Every `ConfirmDialog` gets `pending`; errors render inside the dialog that can fail.
- The editor is lazy: nothing from `@codemirror/*` may enter the shell's entry chunk.
- No em dashes anywhere. No `Co-Authored-By` trailers, no Claude or Anthropic attribution.
- Both trees are shared with live sessions. Commit by explicit path, paths inline; stage new files with `git add <path>`; never `git add -A`, `git commit -a` or `--amend`; verify by SHA; restore only from your own backup or `git checkout -- <exact path>`; delete only files you created, by exact name; never touch local port 5432.

## What the `dsl` package actually does

Verified against `warden/dsl` for this plan.

- `Parse(file, src) (*Program, []*Diagnostic)`: each `Diagnostic` has `Pos{File, Line, Col}` (1-based; `Col` is a **byte** column) and `Msg`. `Parse` does no variable substitution; the lexer has no `$` token, so `${NAME}` is a lexical error. `import "path"` declarations are parsed into `Program.Imports` and nothing in `Parse` or `Apply` reads them; only the file loaders merge programs.
- `Resolve(prog) []*Diagnostic` checks references. `Apply` calls it first and returns `*DiagnosticError{Diags}` when it fails.
- `Apply(ctx, eng, prog, ApplyOptions{TenantID, DryRun, Prune})`: the tenant is `opts.TenantID` when set, else the source's `tenant`. `DryRun` plans without writing. `Prune` deletes tenant entities **within the namespaces covered by the program** that the program does not declare, and is refused for the global scope. It returns `ApplyResult{Created, Updated, Deleted []string, NoOps int}`, the summary lines `+ kind/name`, `~ kind/name (field: old → new)`, `- kind/name`.
- **Apply is not transactional.** It writes resource types, then permissions, roles, role permissions, policies and relations, each directly through the store, and returns on the first error. Writes before the error stay.
- **Apply audits as the system.** Every mutation emits `EmitAudit` with actor `system`, `Via: "declarative"`, with the entity's normal typed action. It does not know the dashboard operator.
- `BuildProgram(ctx, eng, ExportOptions{TenantID, NamespacePrefix})` reads the tenant's roles, permissions, policies, resource types and relations (no assignments) into a `Program`; `Format(prog)` renders canonical source, and `apply(export(state))` is a no-op.
- The language's keywords are those in `dsl/token.go`; `editor/warden.tmLanguage.json` is the reference grammar.

## Deviations from the spec

1. **Apply is guarded by a plan digest.** The spec says plan before apply is mandatory. A page can only enforce that for its own button; the server enforces it too: `schema.plan` returns a digest of its diff, `schema.apply` takes it, reruns the dry run and refuses with `CONFLICT` when the diff differs. An operator therefore never applies a diff other than the one they saw, even if the store changed in between. A narrow window remains between that check and the writes.
2. **The dashboard refuses what the file loaders would do and it cannot.** Source with `import` declarations or `${NAME}` variables is refused with a diagnostic at the offending position, instead of silently ignoring the import or failing on the variable, since a dashboard cannot read server files or environment.
3. **A source `tenant` other than the operator's is refused**, not silently overridden, so the text on screen never claims a tenant the apply will not use.
4. **The contract records one operator-attributed audit event per apply** (`schema.applied`, with the counts), because the per-entity events the applier emits name the system, not the person.

## Review Focus

1. **Applying a diff the operator did not see.** Covered by the digest (Tasks 1 and 2).
2. **Prune deleting more than shown.** The prune confirmation names the plan's own deleted count and lines; the digest covers the prune flag, so an apply without the prune plan it confirmed is refused.
3. **A partial apply read as a clean failure or a success.** The apply error sentence says writes before the error stay.
4. **Source that reaches outside the request.** Imports and variables are refused; the tenant always comes from the principal.
5. **Grants.** Export needs read on all five exported kinds; plan the same; apply needs manage on all five.

---

## File Structure

**warden** (`/Users/rexraphael/Work/xraph/forgery/warden`, branch `soc2-hardening`)

| File | Responsibility |
|---|---|
| `extension/contract/handlers_schema.go` (create) | DTOs, source checks, digest, the three handlers |
| `extension/contract/handlers_schema_test.go` (create) | Handler tests |
| `extension/contract/{contract.go,manifest.yaml,authz.go}` + three guard tests (modify) | Registration and guards |

**forge-dashboard** (`main`)

| File | Responsibility |
|---|---|
| `packages/fixture-server/warden-fixtures.mjs` (modify) | Three handlers over a declaration-level model of the seed |
| `packages/plugin-warden/src/components/warden-language.ts` (create) | `StreamLanguage` for Warden DSL |
| `packages/plugin-warden/src/components/schema-editor.tsx` (create) | CodeMirror editor with lint markers |
| `packages/plugin-warden/src/pages/schema.tsx` (create) | The page, lazily loaded |
| `packages/plugin-warden/src/index.tsx`, `package.json` (modify) | Lazy route, nav, dependencies |

---

## Task 1: `schema.export` and `schema.plan`

**Files:**
- Create: `extension/contract/handlers_schema.go`, `extension/contract/handlers_schema_test.go`
- Modify: `contract.go`, `manifest.yaml`, `authz.go`, and the three guard tests

**Interfaces:**
- Produces:

```go
type SchemaExportInput struct {
	// NamespacePrefix limits the export to that namespace and below. "" is
	// every namespace.
	NamespacePrefix string `json:"namespacePrefix,omitempty"`
}

type SchemaExportResponse struct {
	Source string `json:"source"`
}

type SchemaDiagnostic struct {
	Line    int    `json:"line"`    // 1-based
	Col     int    `json:"col"`     // 1-based byte column, as dsl.Pos
	Message string `json:"message"`
}

type SchemaPlanInput struct {
	Source string `json:"source"`
	Prune  bool   `json:"prune"`
}

type SchemaPlanResponse struct {
	// Valid is false when Diagnostics is non-empty; then the lists are empty
	// and Digest is "".
	Valid       bool               `json:"valid"`
	Diagnostics []SchemaDiagnostic `json:"diagnostics"`
	Created     []string           `json:"created"`
	Updated     []string           `json:"updated"`
	Deleted     []string           `json:"deleted"`
	NoOps       int                `json:"noOps"`
	// Digest identifies this exact diff and prune flag; schema.apply
	// requires it.
	Digest string `json:"digest"`
}
```

- Produces (unexported, Task 3 reuses): `func checkSource(src string, tenantID string) (*dsl.Program, []SchemaDiagnostic)` and `func planDigest(prune bool, r *dsl.ApplyResult) string`.

- [ ] **Step 1: Write the failing tests**

1. Export round-trip: seed roles, permissions, a role grant, a policy with conditions, a resource type with relations and a permission expression, and a relation; `schema.export` returns source whose `schema.plan` against the same store is valid with empty `created`, `updated`, `deleted`. `namespacePrefix: "eng"` excludes a root-only entity.
2. Plan: a source adding one role and changing one permission's description gives exactly those lines in `created` and `updated`, a positive `noOps`, `valid: true`, a non-empty digest; the store is unchanged afterwards (count every entity kind).
3. Prune plan: with `prune: true`, an entity the source omits in a namespace the source covers appears in `deleted`; one in a namespace the source does not mention does not.
4. Diagnostics, each `valid: false`, empty lists, empty digest, and the exact `line`/`col` from the dsl diagnostic: a syntax error; a reference `Resolve` rejects; `import "x.warden"` (message `imports are not supported here: paste the imported source instead`, at the import's position); `${NAME}` (whatever the lexer reports, at its position; assert the position); `tenant "other"` when the principal's tenant differs (message `this source names tenant "other"; the dashboard applies to your tenant only`, at the tenant declaration's position; a `tenant` equal to the principal's is accepted).
5. Digest: the same source and prune give the same digest twice; flipping `prune` changes it; a store change that alters the diff changes it.
6. Grants: a principal missing any of `read` on `warden:role`, `warden:permission`, `warden:policy`, `warden:resourcetype`, `warden:relation` is refused `PERMISSION_DENIED` naming that grant, for both intents.
7. Tenant: an export never contains another tenant's entities.

- [ ] **Step 2: Run to see them fail**, then **Step 3: implement**

`checkSource`: `dsl.Parse("schema.warden", []byte(src))`; if parse diagnostics, return them. Refuse imports (the first `ImportDecl.Pos`) and a mismatched `prog.Tenant` (read `ast.go` for where the tenant's position is kept; if none, use line 1 col 1 and say so in the report). `dsl.Resolve` diagnostics next. `planDigest`: SHA-256 over `prune`, then each list sorted and length-prefixed, then `NoOps`, hex-encoded. `schema.plan` runs `dsl.Apply(ctx, eng, prog, dsl.ApplyOptions{TenantID: tenant, DryRun: true, Prune: in.Prune})`; a `*dsl.DiagnosticError` becomes diagnostics, any other error goes through `mapWardenError`. `schema.export` runs `dsl.BuildProgram` then `dsl.Format`.

- [ ] **Step 4: Register and guard**

Both are queries (`capability: read`), `schemaExport` with `staleTime: 15s` and `schemaPlan` with `staleTime: 0s`. `intentPolicies`: `{"read", "warden:role"}` for both, with the other four read grants checked in the handler through `principalHolds`. The three guards.

- [ ] **Step 5: Run, mutate, commit**

`go test ./extension/contract/ -run 'Schema|Manifest|Authz|Tenant' -v`, then `go build ./... && go test ./...`. Mutate once (drop the prune flag from the digest), confirm test 5 fails, restore.

```bash
git add extension/contract/handlers_schema.go extension/contract/handlers_schema_test.go
git commit -m "feat(contract): export the schema as source and plan an edit" -- extension/contract/handlers_schema.go extension/contract/handlers_schema_test.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/authz.go extension/contract/handlers_tenant_test.go extension/contract/manifest_test.go extension/contract/authz_test.go
```

---

## Task 2: `schema.apply`

**Files:**
- Modify: `extension/contract/handlers_schema.go`, its test, and the registration files and guards

**Interfaces:**

```go
type SchemaApplyInput struct {
	Source string `json:"source"`
	Prune  bool   `json:"prune"`
	// Digest is the plan digest the operator saw.
	Digest string `json:"digest"`
}

type SchemaApplyResponse struct {
	Created []string `json:"created"`
	Updated []string `json:"updated"`
	Deleted []string `json:"deleted"`
	NoOps   int      `json:"noOps"`
}
```

- [ ] **Step 1: Write the failing tests**

1. Apply with the digest from a fresh plan writes exactly the planned changes (read the store back) and returns the same lines.
2. `CONFLICT` with message `the schema changed since you planned: plan again` when the store changed between plan and apply, or the digest is for the other prune value, or it is empty; nothing is written.
3. Diagnostics: invalid source is `BAD_REQUEST` naming the first diagnostic's line and column; nothing is written.
4. Grants: missing `manage` on any of the five kinds is `PERMISSION_DENIED` naming it; nothing is written.
5. Audit: one `schema.applied` event via `emitAudit` with the operator as actor (through `withActor`) and the four counts in the entity; none on a refusal.
6. Partial failure: a store double that fails on the first policy write returns an error, and the resource types, permissions and roles written before it remain (the test asserts they are there, pinning the non-transactional fact the page states).

- [ ] **Step 2: Implement**

`checkSource`, then a dry run and `planDigest` comparison, then the real `dsl.Apply` with the same options, then `emitAudit`. `invalidates`: every list and detail query in the manifest that shows a role, permission, policy, resource type or relation, plus `namespaces.list`, `overview.stats` and `subjects.detail`; assert the list in `manifest_test.go`. `intentPolicies`: `{"manage", "warden:role"}` plus the other four `manage` grants in the handler.

- [ ] **Step 3: Run, mutate, commit**

Mutate once (skip the digest comparison), confirm test 2 fails, restore.

```bash
git commit -m "feat(contract): apply a planned schema edit, only as planned" -- extension/contract/handlers_schema.go extension/contract/handlers_schema_test.go extension/contract/contract.go extension/contract/manifest.yaml extension/contract/authz.go extension/contract/handlers_tenant_test.go extension/contract/manifest_test.go extension/contract/authz_test.go
```

---

## Task 3: Fixture

**Files:**
- Modify: `packages/fixture-server/warden-fixtures.mjs`

The fixture cannot run warden's parser, so it models source at the declaration level, enough to click every state.

- [ ] **Step 1: The three handlers**

- `schema.export` renders the seed as Warden source in the shape `dsl.Format` produces (read `dsl/format.go` and a `dsl/testdata` file for the layout), one declaration per seeded role, permission, policy, resource type and relation, filtered by `namespacePrefix`.
- `schema.plan` checks, in order: unbalanced braces (diagnostic at the line of the unmatched brace, message `unbalanced braces`), an `import` line, a `${` token, a `tenant` naming another tenant (same messages and positions as Task 1). Otherwise it extracts declaration headers (`role "slug"`, `permission "name"`, `policy "name"`, `resource "name"`, `relation ...`, each with its `namespace` block) and diffs them against the exported headers: new headers are `created`, same header with different block text is `updated`, missing headers are `deleted` only when `prune` is true and the header's namespace appears in the source. Summary lines use the Go shapes (`+ role/slug`, `~ role/slug (...)`, `- role/slug`). The digest mirrors Task 1's rule over these lists.
- `schema.apply` mirrors Task 2's digest check and refusals, then applies the diff to the seed arrays (so the other pages change after an apply), and answers the counts.

- [ ] **Step 2: Check by hand**

Start the fixture server on a free port, stop it by PID. Export, plan the export unchanged (empty diff), add a role, plan, apply with the digest, and confirm the roles page data now includes it; apply with a stale digest and confirm `CONFLICT`. Record the requests and answers.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(fixture): serve the warden schema export, plan and apply" -- packages/fixture-server/warden-fixtures.mjs
```

---

## Task 4: The schema page

**Files:**
- Create: `src/components/warden-language.ts`, `src/components/schema-editor.tsx`, `src/pages/schema.tsx`, `test/schema.test.tsx`, `test/warden-language.test.ts`
- Modify: `src/index.tsx`, `test/plugin.test.tsx`, `package.json`

- [ ] **Step 1: Dependencies**

Add to `packages/plugin-warden/package.json` `dependencies` the same `@codemirror/*` versions Chronicle and Vault use (`state`, `view`, `language`, `commands`, `search`), plus `@codemirror/lint` at the version matching that line. Run `pnpm install` for the workspace; commit the lockfile change with this task only if it is limited to these packages (if the install rewrites unrelated lockfile lines, stop and report instead of committing them).

- [ ] **Step 2: The language**

`warden-language.ts` exports `wardenLanguage`, a `StreamLanguage` whose tokenizer marks: `//` line comments (`comment`), double-quoted strings with `\` escapes (`string`), numbers (`number`), the keywords listed in `dsl/token.go` (`keyword`), `true`/`false` (`bool`), and punctuation. Test it by tokenizing a sample from `dsl/testdata` and asserting the token classes of a keyword, a string, a comment and an identifier.

- [ ] **Step 3: Write the failing page tests**

1. Load: the page reads `schema.export` into the editor; "Load current schema" reloads it and, when the editor has unsaved edits, asks "Replace your edits with the current schema?" in a `ConfirmDialog` first.
2. Plan: "Plan" sends `schema.plan` with the editor text and the prune value. A valid plan lists created, updated and deleted lines under "Will create", "Will change", "Will delete", with counts, and "{n} unchanged". An empty diff says "Applying this changes nothing."
3. Diagnostics: an invalid plan shows each diagnostic as a lint marker at its line and column in the editor (assert the editor's diagnostic state or the rendered marker) and as a list below with "Line {line}, column {col}: {message}"; Apply is disabled.
4. Apply is enabled only when the last plan is valid, non-empty, and was made for exactly the editor's current text and prune value; any edit after planning disables it and shows "The source has changed since this plan. Plan again before applying."
5. Apply opens a `ConfirmDialog`: "Apply {created} creations, {updated} changes and {deleted} deletions to your tenant?" with `pending`; it sends `schema.apply` with the text, prune value and digest.
6. Prune is a separate control, a switch labelled "Delete entities this source does not declare", never beside Apply. Turning it on invalidates the current plan. When a pruning plan has deletions, Apply's confirmation adds, in destructive text: "This deletes {deleted} entities in the namespaces this source covers: {first five lines}{, and n more}." and a second checkbox "I have read the deletions" that must be ticked before the confirm button enables.
7. Results: after an apply, "Applied: {created} created, {updated} changed, {deleted} deleted." and the editor reloads the export.
8. Refusals, each inside the dialog: `CONFLICT` shows "The schema changed since you planned. Plan again to see the current diff."; any other error shows "The apply stopped with an error: {message}. Changes written before the error are kept; plan again to see what remains."
9. Loading: the page module is imported lazily; a test asserts `index.tsx` references it through `lazy(() => import(...))`, using `import.meta.glob` with `{ query: "?raw", eager: true }` to read the source (no `node:fs`).

- [ ] **Step 4: Implement**

`schema-editor.tsx` follows Chronicle's `json-editor.tsx` (theme tokens, `EditorView` lifecycle) but editable, with `wardenLanguage`, `lintGutter()` and `setDiagnostics` fed from the plan. Convert `line`/`col` to a document offset through `state.doc.line(line).from + col - 1`, clamped to the line's end, since `col` is a byte column and the document is UTF-16: for a line containing non-ASCII text, compute the offset by walking the line's UTF-8 bytes. Test that conversion with a line containing a multi-byte character.

`schema.tsx` holds the flow above. Route `{ path: "/schema", element: lazy(() => import("./pages/schema")) }` (follow Chronicle's lazy pattern in its `index.tsx`); nav `{ label: "Schema", to: "/schema", priority: 30, icon: <FileCode2Icon />, group: "Operations" }`, importing the icon from `@forge-go/dashboard-kit/icons` (pick another it has if not, and say which).

- [ ] **Step 5: Verify and commit**

Run the package's `test`, `typecheck`, `lint`. Then `pnpm --filter @forge-go/dashboard-shell build` (or the shell's build script; read `apps/shell/package.json`) and confirm no `@codemirror` code is in the entry chunk: grep the built entry file for `EditorView` and record the chunk it lands in. Mutate once (leave Apply enabled after an edit), confirm test 4 fails, restore.

```bash
git add packages/plugin-warden/src/components/warden-language.ts packages/plugin-warden/src/components/schema-editor.tsx packages/plugin-warden/src/pages/schema.tsx packages/plugin-warden/test/schema.test.tsx packages/plugin-warden/test/warden-language.test.ts
git commit -m "feat(warden): edit, plan and apply the schema as Warden source" -- packages/plugin-warden/src/components/warden-language.ts packages/plugin-warden/src/components/schema-editor.tsx packages/plugin-warden/src/pages/schema.tsx packages/plugin-warden/test/schema.test.tsx packages/plugin-warden/test/warden-language.test.ts packages/plugin-warden/src/index.tsx packages/plugin-warden/test/plugin.test.tsx packages/plugin-warden/package.json
```

Add the lockfile path only per Step 1's rule.

---

## Carried forward

- **To plan 5b:** the schema graph on `/resource-types`, the rooted instance graph using `MaxGraphDepth`, `MaxGraphVisited` and `MaxGraphFanout`, and the bundle re-measure written into `BASELINE.md`.
- **To plan 6:** `warden/MIGRATION.md`, the authsome retitle, and the templ deletion.
- **Warden follow-ups:** `dsl.Apply` is not transactional; a transactional apply belongs in core.
