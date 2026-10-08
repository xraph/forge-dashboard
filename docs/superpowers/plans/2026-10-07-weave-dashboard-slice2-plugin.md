# Weave slice 2: the React plugin, its fixture and its wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/plugin-weave` with all twelve routes the spec names, give the fixture server a `weave` contributor that answers all 17 intents the way Weave's contract does, and mount the plugin in `apps/shell` and `apps/example-next`.

**Architecture:** A plugin package shaped like `plugin-trove` and `plugin-herald`: one file per page under `src/pages`, the wire types in `src/types.ts` copied from the Go tags, pure helpers (`format.ts`, `links.ts`, `spans.ts`, `retrieval/model.ts`) tested on their own, and kit components for every surface. Pages read through `useQuery` and write through `useCommand` only. The document detail page is a lazy route, so the chunk reader's virtualiser stays out of the shell's entry chunk. The fixture is a self-contained `weave-fixtures.mjs` with its own `weave-verify.mjs`, so the shared `server.mjs` and `verify.mjs` each get a few lines.

**Tech Stack:** React 19, TypeScript 6, vitest 5 with Testing Library and jsdom, `@forge-go/dashboard-plugin` (`useQuery`, `useCommand`, `PluginLink`, `useNavigateTo`, `definePlugin`, `mountPath`), `@forge-go/dashboard-kit` components and icons, `@tanstack/react-virtual` 3. Node 20 for the fixture server.

**Spec:** `docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md`. Read "The React half" (lines 285 to 472), "Fixtures", "Testing / React", and both hand-off sections at the end: "What slice 1 found that slice 2 must know" and "What slice 3 found that slice 2 must know". Where the older text and the slice 3 section disagree, the slice 3 section wins; its last part lists every such place. Read `packages/plugin/PLAYBOOK.md` too. The Go contract is at `/Users/rexraphael/Work/xraph/forgery/weave/extension/contract/` (weave `main`, `5495ebb`): when a field name or an error text in this plan disagrees with the Go source, the Go source wins and you say so in your report.

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. No worktrees, even if a skill asks for one. Other sessions keep uncommitted work in this tree and some of them stage files.
- You may edit only: `packages/plugin-weave/**` (new), `packages/fixture-server/weave-fixtures.mjs` and `weave-verify.mjs` (new), weave's lines in `packages/fixture-server/server.mjs` and `verify.mjs`, weave's lines in `apps/shell/package.json`, `apps/shell/src/App.tsx` and `apps/shell/src/styles.css`, weave's lines in `apps/example-next/package.json`, `forge.config.ts` and `app/globals.css`, a new Weave section at the end of `BASELINE.md` (Task 15), the spec's new hand-off section (Task 15), and `pnpm-lock.yaml` through `pnpm install`. Nothing else. `plugin-keysmith`, `plugin-herald`, `plugin-sentinel` and `plugin-bastion` are other sessions' live work: read them, never edit them. Leave the untracked `_project_files/` alone.
- A file that holds another session's uncommitted edits gets the Edit tool only: no `sed -i`, no shell redirect, no rewrite script. Check with `git diff <path>` before you touch a shared file.
- Commits of files that are wholly yours: `git add <exact new files>`, then `git commit --only -m "<subject>" -m "<body>" -- <exact paths>`, then `git show --stat HEAD`. Never `git add -A`, `git add .` or a bare directory with plain git.
- Commits that touch a SHARED file (`pnpm-lock.yaml`, `server.mjs`, `verify.mjs`, the shell and example-next files) go through the helper `commit-mine.sh` below, which the controller places at `$W/commit-mine.sh`. Pass your own new files with `--whole` and each shared file as `--shared path:NEEDLE`, where NEEDLE is a string every one of your hunks in that file contains. Then run `git show HEAD -- <shared path>` and confirm no line from another session is in it.
- NEVER run `git checkout -- .`, `git restore .`, `git reset --hard`, a bare `git reset`, `git stash`, `git clean`, `git switch`, `git rebase`, `git push` or `--amend`.
- Commit messages: a conventional subject like the log's (`feat(plugin-weave): ...`), then a body of two to five lines of plain prose that addresses the reader as "you" where it's natural and uses "we" for team work, never "I". No `Co-Authored-By` or any other trailer, and no Claude, Anthropic or AI attribution anywhere.
- No em dashes and no en dashes anywhere: code, comments, test names, UI copy, commit messages. Use a comma, a full stop, a colon or parentheses. The ellipsis character `…` is fine for a pending label.
- `extension: "weave"`, `namespace: "weave"`, `label: "Weave"`. Every nav item has `group: "RAG"`. Nav order is Overview, Retrieval, Collections, Documents, Chunks, Pipeline (priorities -10, 0, 10, 20, 30, 40).
- Routes, exactly: `/`, `/retrieval`, `/collections`, `/collections/new`, `/collections/:id`, `/collections/:id/edit`, `/collections/:id/ingest`, `/documents`, `/documents/:id`, `/chunks`, `/chunks/:id`, `/pipeline`.
- Wire field names are the Go JSON tags, snake_case, exactly as `src/types.ts` spells them. Never camelCase a field on the wire.
- Tenant: absent means every tenant, `""` means only untenanted rows, any other string is an exact match. "All tenants" leaves the field out of the request. Use `withTenant(params, tenant)` from `src/tenant.ts`; never send `tenant: null` or `tenant: undefined`.
- The five conventions: every collection, document and chunk ID, hash, content type, tenant ID and byte count carries `font-mono text-xs`; the column an operator reads (a title, a name) carries `font-medium`; every table caption carries a live count from the server's `total`, including at zero; a "none" cell uses `NoneCell`, `TagList` or `Timestamp`, never a blank and never a bare dash; badge colour follows proportion (next line).
- Document state badges (spec, binding): `ready` outline, `pending` secondary, `processing` default, `failed` destructive. A row with `stalled: true` also carries a destructive marker reading "no update for <age>" with the real age. Say "looks stalled" in prose, never "dead" or "stuck".
- Retrieval: scores use `tabular-nums` and three decimals. No score colours and no 0 to 1 bars. The query never goes into the URL. `retrieval.run` and `retrieval.assemble` are called only from a submit or a click, never from a `useEffect`. Name the retriever kind from `system.components`, never from the run result.
- Hits can be partial: `chunk` can be `null`, an orphaned or unidentified hit carries `""` IDs, zero offsets and `created_at` `"0001-01-01T00:00:00Z"`, and an unidentified hit's `chunk.metadata` can be `null`. Never render a zero time as a date or an empty ID as a link (`isRealTime` and the ID checks in `src/retrieval/model.ts`).
- A link whose path carries a query string is absolute: build it with `documentsHref` or `chunksHref` from `src/links.ts`, which start at `WEAVE_MOUNT` (`/@weave`). The host appends the current search to every scope-relative path, so `/documents?state=failed` written relative would come out with two query strings. Paths without a query stay scope-relative (`/collections/<id>`).
- Errors from a command shown in a dialog render INSIDE the dialog (`CommandAlert` as a child of `ConfirmDialog`). Call `reset()` when a dialog OPENS. Every `ConfirmDialog` gets `pending`. Failure tests throw `ContractError` (through `failingClient`, `scriptedClient` or `invalidatingClient`), never a stub answering `{ ok: false }`.
- Pages read through `useQuery` and write through `useCommand`. Never call `usePluginClient` from a page. Never refetch to stay correct after a write: the manifest's `invalidates` does that.
- Tests use the package's `test/harness.tsx` (Herald's harness with `extension: "weave"`). `stubClient` refuses any intent it was not given, so a typo in an intent name turns a test red. Never read a source file with `node:fs` in a test; use `import.meta.glob` with `{ query: "?raw", eager: true }`.
- Per package, before every commit of the package: `pnpm --filter @forge-go/dashboard-plugin-weave test`, `typecheck` and `lint` all clean.
- One runtime dependency: `@tanstack/react-virtual` at `^3.14.11`, the version the kit resolves. Dev and peer dependencies mirror `plugin-trove`'s exactly. Nothing else gets added.

### The commit-mine helper

The controller writes this to `$W/commit-mine.sh` (the SDD workspace) before Task 1. It is not committed anywhere.

```bash
#!/usr/bin/env bash
# commit-mine.sh: commit ONLY this session's changes in a repo where other
# sessions keep uncommitted, sometimes staged, edits in the same files.
#
#   commit-mine.sh -m SUBJECT [-m BODY] [--whole PATH...] [--shared PATH:NEEDLE...]
#
# --whole   paths that are entirely yours: committed as they are in the tree.
# --shared  paths others also have uncommitted edits in: only the diff hunks
#           against HEAD (zero context) that contain NEEDLE are applied to
#           HEAD's copy of the file, at their exact old-side line numbers.
#
# The commit is built in a private index that starts from HEAD, so neither the
# shared index nor anyone's staged work is read or changed by it. Afterwards
# each committed path's entry in the shared index is moved to the new blob,
# but only where it still held the old HEAD blob, so nobody's staging is lost.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
msgs=(); whole=(); shared=(); mode=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) msgs+=(-m "$2"); shift 2 ;;
    --whole) mode=whole; shift ;;
    --shared) mode=shared; shift ;;
    *)
      if [ "$mode" = whole ]; then whole+=("$1")
      elif [ "$mode" = shared ]; then shared+=("$1")
      else echo "commit-mine: unexpected argument $1" >&2; exit 2; fi
      shift ;;
  esac
done
[ ${#msgs[@]} -gt 0 ] || { echo "commit-mine: -m is required" >&2; exit 2; }
old_head=$(git rev-parse HEAD)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"
git read-tree HEAD
paths=()
for p in ${whole[@]+"${whole[@]}"}; do git add -- "$p"; paths+=("$p"); done
for spec in ${shared[@]+"${shared[@]}"}; do
  p=${spec%%:*}; needle=${spec#*:}
  git show "$old_head:$p" > "$tmp/old"
  git diff -U0 "$old_head" -- "$p" > "$tmp/full.patch"
  python3 - "$needle" "$tmp/old" "$tmp/full.patch" "$tmp/new" <<'PY'
import re, sys
needle, old_path, patch_path, out_path = sys.argv[1:5]
old = open(old_path, encoding="utf-8").read().splitlines(keepends=True)
hunks, cur = [], None
for line in open(patch_path, encoding="utf-8").read().splitlines(keepends=True):
    m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", line)
    if m:
        cur = {"os": int(m.group(1)), "ol": int(m.group(2) or 1), "minus": [], "plus": []}
        hunks.append(cur)
    elif cur is not None and line.startswith("-"):
        cur["minus"].append(line[1:])
    elif cur is not None and line.startswith("+"):
        cur["plus"].append(line[1:])
mine = [h for h in hunks if any(needle in l for l in h["minus"] + h["plus"])]
if not mine:
    sys.exit(f"commit-mine: no hunk mentions {needle!r}")
for h in sorted(mine, key=lambda h: h["os"], reverse=True):
    if h["ol"] == 0:
        at = h["os"]  # insert after old line os
        old[at:at] = h["plus"]
    else:
        start = h["os"] - 1
        if old[start:start + h["ol"]] != h["minus"]:
            sys.exit(f"commit-mine: hunk at old line {h['os']} does not match HEAD")
        old[start:start + h["ol"]] = h["plus"]
open(out_path, "w", encoding="utf-8").write("".join(old))
PY
  blob=$(git hash-object -w "$tmp/new")
  fmode=$(git ls-tree "$old_head" -- "$p" | awk '{print $1}')
  git update-index --add --cacheinfo "$fmode,$blob,$p"
  paths+=("$p")
done
if [ "$(git rev-parse HEAD)" != "$old_head" ]; then
  echo "commit-mine: HEAD moved while preparing; rerun" >&2; exit 1
fi
git commit "${msgs[@]}"
unset GIT_INDEX_FILE
for p in "${paths[@]}"; do
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    new=$(git rev-parse "HEAD:$f")
    old=$(git rev-parse -q --verify "$old_head:$f" 2>/dev/null || true)
    cur=$(git ls-files -s -- "$f" | awk '{print $2}')
    if [ -z "$cur" ] || [ "$cur" = "$old" ]; then
      fm=$(git ls-tree HEAD -- "$f" | awk '{print $1}')
      git update-index --add --cacheinfo "$fm,$new,$f"
    else
      echo "commit-mine: left $f alone in the shared index; someone has it staged" >&2
    fi
  done < <(git ls-tree -r --name-only HEAD -- "$p")
done
git show --stat HEAD
```

## Review Focus

1. "All tenants" and "No tenant" are different requests. Picking "No tenant" must send `tenant: ""` and picking "All tenants" must leave `tenant` out entirely; a page that sends `""` for "all" shows only untenanted rows and looks right on a single-tenant deployment. Pinned in Task 1 ("All leaves the field out, No tenant sends an empty string") and Task 9 ("sends tenant only when one is picked").
2. A text file under Weave's 1 MiB content cap whose escaped request is over the transport's 1 MiB envelope (a file of short lines, quotes or tabs) must be refused on the page, before it is sent, with the transport's limit named and the operator's setting given. Pinned in Task 8 ("refuses content whose encoded request is over the transport limit").
3. Re-assembling after a run that had a hit with a `null` chunk must send `content: null` for it, not `""`; otherwise every `[n]` marker after it points at the wrong row. Pinned in Task 12 ("sends null content for a hit with no chunk") and Task 13 ("re-assembles with the run's hits, null content included").
4. An orphaned or unidentified hit carries `created_at` `"0001-01-01T00:00:00Z"` and empty IDs. The inspector must not show "Jan 1, 1" or a link to `/documents/`. Pinned in Task 13 ("shows an orphaned hit without a date or a broken link").
5. Documents opened from a link whose `collection_id` names a deleted collection answer an empty page, not an error. The page must say no documents match these filters and offer to clear them, not "no documents yet". Pinned in Task 9 ("says the filters matched nothing and offers to clear them").

---

### Task 1: Package scaffold, shared modules and the plugin definition

**Files:**
- Create: `packages/plugin-weave/package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- Create: `packages/plugin-weave/src/types.ts`, `src/format.ts`, `src/badges.tsx`, `src/links.ts`, `src/tenant.ts`, `src/paging.ts`, `src/use-debounced.ts`, `src/components/id.tsx`, `src/components/metadata-list.tsx`, `src/components/tenant-filter.tsx`, `src/index.tsx`
- Test: `packages/plugin-weave/test/setup.ts`, `test/harness.tsx`, `test/format.test.ts`, `test/badges.test.tsx`, `test/links.test.tsx`, `test/tenant-filter.test.tsx`, `test/plugin.test.tsx`
- Modify (through `pnpm install`): `pnpm-lock.yaml`

**Interfaces:**
- Produces (later tasks import these exact names):
  - `src/types.ts`: `DocumentState`, `ListOutput<T>`, `StateCounts`, `Collection`, `CollectionDetail`, `DocumentRow`, `Chunk`, `HitChunk`, `ScoreKind`, `ComponentInfo`, `PipelineComponent`, `Components`, `EngineConfig`, `ExtensionInfo`, `ComponentsOutput`, `Overview`, `Span`, `SpansOutput`, `IngestOutput`, `ReindexOutput`, `ChunkDetail`, `Hit`, `CompareResult`, `AssembledContext`, `RunOutput`, `AssembleHit`, `IdOutput`
  - `src/format.ts`: `formatCount(n)`, `formatBytes(n)`, `formatScore(n)`, `formatMs(ms)`, `plural(n, one, many)`, `formatAge(seconds)`, `ageSeconds(iso, now?)`, `isRealTime(iso)`, `utf8Length(text)`
  - `src/badges.tsx`: `DocumentStateBadge({ state })`, `StalledMarker({ updatedAt, now? })`, `DocumentStateCell({ doc })`
  - `src/links.ts`: `WEAVE_MOUNT`, `collectionPath(id)`, `collectionEditPath(id)`, `collectionIngestPath(id)`, `documentPath(id)`, `chunkPath(id)`, `documentsHref(filter)`, `chunksHref(collectionId?)`, `useSearchParam(name)`, `useSetSearchParams(path)`
  - `src/tenant.ts`: `withTenant(params, tenant)`; `src/components/tenant-filter.tsx`: `TenantFilter({ value, onChange })`
  - `src/paging.ts`: `pageOf(list)`, `offsetFor(page, limit)`, `PAGE_SIZE`
  - `src/use-debounced.ts`: `useDebounced(value, ms)`
  - `src/components/id.tsx`: `Id({ value })`, `IdLink({ to, value, label? })`
  - `src/components/metadata-list.tsx`: `MetadataList({ metadata })`
  - `test/harness.tsx`: `stubClient`, `recordingQueryClient`, `recordingCommandClient`, `failingClient`, `pendingClient`, `scriptedClient`, `invalidatingClient`, `renderPage`, `renderWithNavigate`
  - `src/index.tsx`: `weavePlugin` (default and named export) with `nav: []` and `routes: []`. Each page task adds its nav entry and route.

- [ ] **Step 1: Create the package config**

`packages/plugin-weave/package.json`:

```json
{
  "name": "@forge-go/dashboard-plugin-weave",
  "version": "0.0.0",
  "type": "module",
  "files": ["src"],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "test": "vitest run",
    "lint": "eslint",
    "format": "prettier --write \"**/*.{ts,tsx}\"",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@forge-go/dashboard-kit": "^0.1.0",
    "@forge-go/dashboard-plugin": "^0.1.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "dependencies": {
    "@tanstack/react-virtual": "^3.14.11"
  },
  "devDependencies": {
    "@eslint/js": "^10",
    "@forge-go/dashboard-kit": "workspace:*",
    "@forge-go/dashboard-plugin": "workspace:*",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6",
    "eslint": "^10",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17",
    "jsdom": "^25.0.1",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "typescript": "~6",
    "typescript-eslint": "^8",
    "vitest": "^5.0.0"
  },
  "exports": {
    ".": "./src/index.tsx"
  }
}
```

Copy `tsconfig.json`, `vitest.config.ts` and `eslint.config.js` byte for byte from `packages/plugin-herald/`. They carry nothing herald-specific. Copy `packages/plugin-herald/test/setup.ts` to `packages/plugin-weave/test/setup.ts` (it gives jsdom a `PointerEvent` and Range geometry, and raises the async timeout to 5s), then append the `ResizeObserver` stub from `packages/plugin-trove/test/setup.ts` (the `if (typeof globalThis.ResizeObserver === "undefined")` block with its comment). The chunk reader in Task 10 uses `@tanstack/react-virtual`, which observes element sizes, and jsdom has no `ResizeObserver`.

Then from the repo root run `pnpm install`. It links the new package and adds a `packages/plugin-weave:` importer block to `pnpm-lock.yaml`. Run `git diff pnpm-lock.yaml` and confirm your block is separate from any other session's hunks.

- [ ] **Step 2: Write the test harness**

Copy `packages/plugin-herald/test/harness.tsx` to `packages/plugin-weave/test/harness.tsx`, then replace every `"herald"` string literal with `"weave"`. There are seven: the `extension` of `stubClient`, `failingClient`, `pendingClient`, `scriptedClient` and `invalidatingClient`, and the first argument of `queryStore.invalidate`. Change nothing else. Grep the file for `herald` afterwards; the only hit left may be the comment that says the file was copied from plugin-relay's harness.

- [ ] **Step 3: Write the failing tests**

`test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { ageSeconds, formatAge, formatBytes, formatCount, formatMs, formatScore, isRealTime, plural, utf8Length } from "../src/format"

describe("format", () => {
  it("groups counts and bytes", () => {
    expect(formatCount(4096)).toBe("4,096")
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(1048576)).toBe("1,048,576 B")
  })

  it("gives scores three decimals", () => {
    expect(formatScore(0.8312)).toBe("0.831")
    expect(formatScore(1)).toBe("1.000")
  })

  it("rounds milliseconds, with a decimal under ten", () => {
    expect(formatMs(412.4)).toBe("412 ms")
    expect(formatMs(1234.5)).toBe("1,235 ms")
    expect(formatMs(3.25)).toBe("3.3 ms")
  })

  it("pluralises with a grouped count", () => {
    expect(plural(1, "chunk", "chunks")).toBe("1 chunk")
    expect(plural(0, "chunk", "chunks")).toBe("0 chunks")
    expect(plural(1200, "chunk", "chunks")).toBe("1,200 chunks")
  })

  it("states an age in whole minutes, hours or days", () => {
    expect(formatAge(30)).toBe("1 min")
    expect(formatAge(47 * 60)).toBe("47 min")
    expect(formatAge(3 * 3600 + 59)).toBe("3 h")
    expect(formatAge(2 * 86400 + 5)).toBe("2 d")
  })

  it("measures an age against the clock it is given", () => {
    const now = Date.parse("2026-10-07T12:00:00Z")
    expect(ageSeconds("2026-10-07T09:00:00Z", now)).toBe(3 * 3600)
    expect(ageSeconds("2026-10-07T13:00:00Z", now)).toBe(0)
  })

  it("treats Go's zero time and an absent value as no time at all", () => {
    expect(isRealTime("0001-01-01T00:00:00Z")).toBe(false)
    expect(isRealTime("")).toBe(false)
    expect(isRealTime(undefined)).toBe(false)
    expect(isRealTime("2026-10-07T09:00:00Z")).toBe(true)
  })

  it("counts UTF-8 bytes, not characters", () => {
    expect(utf8Length("abc")).toBe(3)
    expect(utf8Length("é")).toBe(2)
    expect(utf8Length("€")).toBe(3)
  })
})
```

`test/badges.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { DocumentStateBadge, DocumentStateCell, StalledMarker } from "../src/badges"

type Variant = "default" | "secondary" | "destructive" | "outline"

/**
 * The kit's Badge carries no data-variant attribute, so a badge's variant is
 * read by comparing its classes with a reference Badge of each variant.
 */
function variantOf(text: string | RegExp): Variant | null {
  const el = screen.getByText(text)
  for (const v of ["default", "secondary", "destructive", "outline"] as const) {
    const { container, unmount } = render(<Badge variant={v}>ref</Badge>)
    const ref = container.firstElementChild?.className
    unmount()
    if (ref === el.className) return v
  }
  return null
}

describe("DocumentStateBadge", () => {
  it.each([
    ["ready", "outline"],
    ["pending", "secondary"],
    ["processing", "default"],
    ["failed", "destructive"],
  ] as const)("%s is %s", (state, variant) => {
    render(<DocumentStateBadge state={state} />)
    expect(variantOf(state)).toBe(variant)
  })
})

describe("StalledMarker", () => {
  it("states the real age and is destructive", () => {
    const now = Date.parse("2026-10-07T12:00:00Z")
    render(<StalledMarker updatedAt="2026-10-07T09:00:00Z" now={now} />)
    expect(variantOf("no update for 3 h")).toBe("destructive")
  })
})

describe("DocumentStateCell", () => {
  it("adds the marker only to a row the server calls stalled", () => {
    const old = "2020-01-01T00:00:00Z"
    const { unmount } = render(<DocumentStateCell doc={{ state: "processing", stalled: false, updated_at: old }} />)
    expect(screen.queryByText(/no update for/)).toBeNull()
    unmount()
    render(<DocumentStateCell doc={{ state: "processing", stalled: true, updated_at: old }} />)
    expect(screen.getByText("processing")).toBeTruthy()
    expect(screen.getByText(/no update for \d+ d/)).toBeTruthy()
  })
})
```

`test/links.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { NavigationProvider, mountPath } from "@forge-go/dashboard-plugin"
import type { NavigateOptions, PluginLinkProps } from "@forge-go/dashboard-plugin"
import type { ReactNode } from "react"
import weavePlugin from "../src/index"
import {
  WEAVE_MOUNT,
  chunkPath,
  chunksHref,
  collectionEditPath,
  collectionIngestPath,
  collectionPath,
  documentPath,
  documentsHref,
  useSearchParam,
  useSetSearchParams,
} from "../src/links"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("links", () => {
  it("start the query-carrying ones at the plugin's real mount point", () => {
    expect(`${WEAVE_MOUNT}/documents`).toBe(mountPath(weavePlugin, "/documents"))
    expect(`${WEAVE_MOUNT}/chunks`).toBe(mountPath(weavePlugin, "/chunks"))
  })

  it("keep paths with no query scope-relative", () => {
    expect(collectionPath("col_1")).toBe("/collections/col_1")
    expect(collectionEditPath("col_1")).toBe("/collections/col_1/edit")
    expect(collectionIngestPath("col_1")).toBe("/collections/col_1/ingest")
    expect(documentPath("doc_1")).toBe("/documents/doc_1")
    expect(chunkPath("chk_1")).toBe("/chunks/chk_1")
  })

  it("put only the filters that are set into the query, in a fixed order", () => {
    expect(documentsHref({})).toBe("/@weave/documents")
    expect(documentsHref({ state: "failed", collection_id: "col_1" })).toBe("/@weave/documents?collection_id=col_1&state=failed")
    expect(documentsHref({ collection_id: "", state: "" })).toBe("/@weave/documents")
    expect(chunksHref("col_1")).toBe("/@weave/chunks?collection_id=col_1")
    expect(chunksHref()).toBe("/@weave/chunks")
  })
})

describe("search params", () => {
  it("reads a param from the address", () => {
    window.history.replaceState(null, "", "/@weave/documents?state=failed")
    const { result } = renderHook(() => useSearchParam("state"))
    expect(result.current).toBe("failed")
  })

  it("sets and clears params through the host, replacing the entry and keeping the others", () => {
    window.history.replaceState(null, "", "/@weave/documents?state=failed&collection_id=col_1")
    const calls: { to: string; options?: NavigateOptions }[] = []
    const wrapper = ({ children }: { children: ReactNode }) => (
      <NavigationProvider
        value={{
          Link: ({ to, children: c }: PluginLinkProps) => <a href={to}>{c}</a>,
          navigate: (to: string, options?: NavigateOptions) => {
            calls.push({ to, options })
            window.history.replaceState(null, "", to)
          },
        }}
      >
        {children}
      </NavigationProvider>
    )
    const { result } = renderHook(() => ({ set: useSetSearchParams("/documents"), state: useSearchParam("state") }), { wrapper })
    act(() => result.current.set({ state: "" }))
    expect(calls).toEqual([{ to: "/@weave/documents?collection_id=col_1", options: { replace: true } }])
    expect(result.current.state).toBe("")
  })
})
```

`test/tenant-filter.test.tsx`:

```tsx
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { TenantFilter } from "../src/components/tenant-filter"
import { withTenant } from "../src/tenant"

function Probe() {
  const [tenant, setTenant] = useState<string | null>(null)
  return (
    <div>
      <TenantFilter value={tenant} onChange={setTenant} />
      <output aria-label="sent">{JSON.stringify(withTenant({ limit: 25 }, tenant))}</output>
    </div>
  )
}

describe("withTenant", () => {
  it("All leaves the field out, No tenant sends an empty string", () => {
    expect(withTenant({ limit: 25 }, null)).toEqual({ limit: 25 })
    expect("tenant" in withTenant({}, null)).toBe(false)
    expect(withTenant({}, "")).toEqual({ tenant: "" })
    expect(withTenant({}, "acme")).toEqual({ tenant: "acme" })
  })
})

describe("TenantFilter", () => {
  it("starts on every tenant", () => {
    render(<Probe />)
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25}')
  })

  it("narrows to untenanted rows", () => {
    render(<Probe />)
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "none" } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25,"tenant":""}')
  })

  it("narrows to a named tenant, trimmed, and treats a blank name as no filter yet", () => {
    render(<Probe />)
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "named" } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25}')
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "  acme " } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25,"tenant":"acme"}')
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "all" } })
    expect(screen.getByLabelText("sent").textContent).toBe('{"limit":25}')
    expect(screen.queryByLabelText("Tenant ID")).toBeNull()
  })
})
```

`test/plugin.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import weavePlugin, { weavePlugin as named } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({ name, envelopes: ["v1"], configured: true })),
  }
}

describe("weavePlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(weavePlugin).toBe(named)
  })

  // The join key, checked against what the host does with it rather than
  // compared to itself: weave/extension/contract/manifest.yaml registers the
  // contributor as "weave".
  it("resolves to ready against a host reporting weave's contributor", () => {
    expect(resolvePluginState(weavePlugin, capabilities("weave"))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report weave", () => {
    expect(resolvePluginState(weavePlugin, capabilities("trove")).kind).toBe("hidden")
  })

  it("carries the extension's name as its namespace and label", () => {
    expect(weavePlugin.namespace).toBe("weave")
    expect(weavePlugin.label).toBe("Weave")
  })
})
```

Each page task appends one `it` to this file, checking its nav entry and route.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, the `src` modules are not found.

- [ ] **Step 5: Write the shared modules**

`src/types.ts`:

```ts
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
```

`src/format.ts`:

```ts
const grouped = new Intl.NumberFormat("en-US")
const encoder = new TextEncoder()

export function formatCount(n: number): string {
  return grouped.format(n)
}

/** An exact byte count: "4,812 B". */
export function formatBytes(n: number): string {
  return `${grouped.format(n)} B`
}

/** A score as the retrieval page shows it: three decimals, no colour. */
export function formatScore(n: number): string {
  return n.toFixed(3)
}

export function formatMs(ms: number): string {
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${grouped.format(Math.round(ms))} ms`
}

export function plural(n: number, one: string, many: string): string {
  return `${grouped.format(n)} ${n === 1 ? one : many}`
}

/** "47 min", "3 h", "2 d": whole units, rounded down, never under a minute. */
export function formatAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))} min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`
  return `${Math.floor(seconds / 86400)} d`
}

export function ageSeconds(iso: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
}

/**
 * Whether a timestamp names a real moment. An orphaned retrieval hit carries
 * Go's zero time, "0001-01-01T00:00:00Z", which must never render as a date.
 */
export function isRealTime(iso: string | null | undefined): iso is string {
  return typeof iso === "string" && iso !== "" && !iso.startsWith("0001-01-01")
}

export function utf8Length(text: string): number {
  return encoder.encode(text).length
}
```

`src/badges.tsx`:

```tsx
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { ageSeconds, formatAge } from "./format"
import type { DocumentRow, DocumentState } from "./types"

/**
 * Proportion first, per the playbook. Ready is the majority in any healthy
 * collection, so it recedes. Pending is transient. Processing is worth a
 * second look, because ingest runs inside one request. Failed is what an
 * operator came to find.
 */
const STATE_VARIANT: Record<DocumentState, "outline" | "secondary" | "default" | "destructive"> = {
  ready: "outline",
  pending: "secondary",
  processing: "default",
  failed: "destructive",
}

export function DocumentStateBadge({ state }: { state: DocumentState }) {
  return <Badge variant={STATE_VARIANT[state] ?? "outline"}>{state}</Badge>
}

/**
 * The age of a processing document's last update. Weave has no heartbeat, so
 * this states the age and does not call the document dead.
 */
export function StalledMarker({ updatedAt, now }: { updatedAt: string; now?: number }) {
  return (
    <Badge
      variant="destructive"
      title="Ingest runs inside one request, so a document still processing after this long has probably lost its process. Weave has no heartbeat to say for sure."
    >
      no update for {formatAge(ageSeconds(updatedAt, now))}
    </Badge>
  )
}

/** The state badge, plus the marker when the server says the row looks stalled. */
export function DocumentStateCell({ doc }: { doc: Pick<DocumentRow, "state" | "stalled" | "updated_at"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <DocumentStateBadge state={doc.state} />
      {doc.stalled ? <StalledMarker updatedAt={doc.updated_at} /> : null}
    </span>
  )
}
```

`src/links.ts`:

```ts
import { useSyncExternalStore } from "react"
import { useNavigateTo } from "@forge-go/dashboard-plugin"

/**
 * Where this plugin mounts. Weave declares no routed context dimension, so
 * its pages always live under "/@weave" (definePlugin makes the namespace
 * the extension name). test/links.test.tsx checks it against mountPath.
 */
export const WEAVE_MOUNT = "/@weave"

const seg = (id: string) => encodeURIComponent(id)

// Scope-relative: no query, so the host's resolver can place them.
export const collectionPath = (id: string) => `/collections/${seg(id)}`
export const collectionEditPath = (id: string) => `/collections/${seg(id)}/edit`
export const collectionIngestPath = (id: string) => `/collections/${seg(id)}/ingest`
export const documentPath = (id: string) => `/documents/${seg(id)}`
export const chunkPath = (id: string) => `/chunks/${seg(id)}`

export interface DocumentFilter {
  collection_id?: string
  state?: string
}

/**
 * Absolute on purpose. The host appends the current search to every
 * scope-relative path, so a relative "/documents?state=failed" written on a
 * page already at "?state=ready" would come out with two query strings. A
 * path starting with the scope sigil passes through untouched.
 */
function absolute(path: string, query: [string, string | undefined][]): string {
  const q = new URLSearchParams()
  for (const [k, v] of query) if (v) q.set(k, v)
  const s = q.toString()
  return `${WEAVE_MOUNT}${path}${s ? `?${s}` : ""}`
}

export function documentsHref(filter: DocumentFilter = {}): string {
  return absolute("/documents", [
    ["collection_id", filter.collection_id],
    ["state", filter.state],
  ])
}

export function chunksHref(collectionId?: string): string {
  return absolute("/chunks", [["collection_id", collectionId]])
}

// Told after every change made through useSetSearchParams, so a reader never
// waits on the host to re-render it.
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("popstate", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("popstate", onChange)
  }
}

/**
 * One query parameter from the address bar, "" when absent. The plugin API
 * gives a page route params and no search, so this reads
 * window.location.search, as Trove's browser and Keysmith's key filter do.
 */
export function useSearchParam(name: string): string {
  return useSyncExternalStore(
    subscribe,
    () => (new URLSearchParams(window.location.search).get(name) ?? "").trim(),
    () => "",
  )
}

/**
 * Sets query parameters on one of this plugin's list pages, deleting any set
 * to "". Through the host's router, replacing the current entry: changing a
 * filter tidies the page you are on, so Back leaves the page rather than
 * stepping back through every filter you tried. Other parameters stay.
 */
export function useSetSearchParams(path: "/documents" | "/chunks"): (changes: Record<string, string>) => void {
  const navigateTo = useNavigateTo()
  return (changes) => {
    const search = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(changes)) {
      if (v === "") search.delete(k)
      else search.set(k, v)
    }
    const s = search.toString()
    navigateTo(`${WEAVE_MOUNT}${path}${s ? `?${s}` : ""}`, { replace: true })
    for (const listener of listeners) listener()
  }
}
```

`src/tenant.ts`:

```ts
/**
 * The tenant filter as the contract reads it. null is "every tenant" and
 * leaves the field out. "" is "only rows written with no tenant". Anything
 * else is an exact match. Absent and "" are different requests, so this is
 * the only way a page adds the field.
 */
export function withTenant<T extends Record<string, unknown>>(params: T, tenant: string | null): T & { tenant?: string } {
  return tenant === null ? params : { ...params, tenant }
}
```

`src/components/tenant-filter.tsx`:

```tsx
import { useState } from "react"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"

type Mode = "all" | "none" | "named"

function modeOf(value: string | null): Mode {
  if (value === null) return "all"
  return value === "" ? "none" : "named"
}

/**
 * Picks the tenant a list or a retrieval run is narrowed to. The dashboard is
 * operator-wide, so the default is every tenant. A named tenant with a blank
 * name is no filter yet, not the untenanted filter.
 */
export function TenantFilter({ value, onChange }: { value: string | null; onChange: (tenant: string | null) => void }) {
  const [mode, setMode] = useState<Mode>(modeOf(value))
  const [name, setName] = useState(value ?? "")

  return (
    <div className="flex items-center gap-2 text-sm">
      <NativeSelect
        aria-label="Tenant"
        value={mode}
        onChange={(e) => {
          const next = e.target.value as Mode
          setMode(next)
          if (next === "all") onChange(null)
          else if (next === "none") onChange("")
          else onChange(name.trim() === "" ? null : name.trim())
        }}
      >
        <NativeSelectOption value="all">All tenants</NativeSelectOption>
        <NativeSelectOption value="none">No tenant</NativeSelectOption>
        <NativeSelectOption value="named">One tenant</NativeSelectOption>
      </NativeSelect>
      {mode === "named" ? (
        <Input
          aria-label="Tenant ID"
          className="w-40 font-mono text-xs"
          placeholder="tenant ID"
          value={name}
          spellCheck={false}
          onChange={(e) => {
            setName(e.target.value)
            onChange(e.target.value.trim() === "" ? null : e.target.value.trim())
          }}
        />
      ) : null}
    </div>
  )
}
```

Check `packages/kit/src/components/native-select.tsx` forwards `value`, `onChange` and `aria-label` to the `<select>`. Trove's store picker relies on it, so it should.

`src/paging.ts`:

```ts
import type { PaginationState } from "@forge-go/dashboard-kit/components/resource-table"

/** What every list asks for. The server clamps it and echoes what it used. */
export const PAGE_SIZE = 25

/** ResourceTable's one-based pagination, from the limit and offset the server applied. */
export function pageOf(list: { total: number; limit: number; offset: number }): PaginationState {
  const limit = list.limit > 0 ? list.limit : PAGE_SIZE
  return { page: Math.floor(list.offset / limit) + 1, pageSize: limit, total: list.total }
}

export function offsetFor(page: number, limit: number): number {
  return Math.max(0, (page - 1) * limit)
}
```

`src/use-debounced.ts`: copy `packages/plugin-herald/src/use-debounced.ts` byte for byte.

`src/components/id.tsx`:

```tsx
import { PluginLink } from "@forge-go/dashboard-plugin"
import { cn } from "@forge-go/dashboard-kit/lib/utils"

/** An identifier: monospace, because it is a raw value you might copy. */
export function Id({ value, className }: { value: string; className?: string }) {
  return <span className={cn("font-mono text-xs break-all", className)}>{value}</span>
}

/** An identifier that opens its record. `to` is scope-relative. */
export function IdLink({ to, value, label }: { to: string; value: string; label?: string }) {
  return (
    <PluginLink to={to} className="font-mono text-xs break-all underline-offset-4 hover:underline" aria-label={label}>
      {value}
    </PluginLink>
  )
}
```

`src/components/metadata-list.tsx`:

```tsx
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"

/** Metadata sorted by key. A retrieval hit's metadata can be null. */
export function MetadataList({ metadata }: { metadata: Record<string, string> | null | undefined }) {
  const map = metadata ?? {}
  const keys = Object.keys(map).sort()
  if (keys.length === 0) return <NoneCell label="metadata" />
  return (
    <DescriptionList
      items={keys.map((k) => ({
        term: k,
        value: <span className="font-mono text-xs break-all">{map[k]}</span>,
      }))}
    />
  )
}
```

`NoneCell` renders its label as "no <label>" for assistive technology. Read `packages/kit/src/components/none-cell.tsx` to confirm the exact wording it produces, because later tests assert on it (`getByLabelText("no metadata")`).

`src/index.tsx`:

```tsx
import { definePlugin } from "@forge-go/dashboard-plugin"

/**
 * The first-party UI for the `weave` extension.
 *
 * `extension` is "weave", the contributor name weave/extension/contract's
 * manifest registers, and test/plugin.test.tsx checks it by resolving against
 * a capabilities document. The dashboard is operator-wide: Weave resolves no
 * tenant on this path, so every page sees every tenant unless it filters.
 */
export const weavePlugin = definePlugin({
  extension: "weave",
  namespace: "weave",
  label: "Weave",
  nav: [],
  routes: [],
})

export default weavePlugin
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: all pass. If `useSetSearchParams` trips `react-hooks` lint because it returns a closure, keep the closure and adjust only what the rule names.

- [ ] **Step 7: Commit**

The package is wholly yours; the lockfile is shared.

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
bash "$W/commit-mine.sh" \
  -m "feat(plugin-weave): scaffold the weave plugin with its wire types and shared helpers" \
  -m "<body>" \
  --whole packages/plugin-weave/package.json packages/plugin-weave/tsconfig.json packages/plugin-weave/vitest.config.ts packages/plugin-weave/eslint.config.js packages/plugin-weave/src packages/plugin-weave/test \
  --shared pnpm-lock.yaml:plugin-weave
git show HEAD -- pnpm-lock.yaml
```

Confirm the lockfile hunk names only `plugin-weave`. Body, for example: the types are the contract's Go tags, the tenant helper keeps "all" and "no tenant" apart, and links that carry a query start at /@weave so the host doesn't append a second query.

---
### Task 2: The weave fixture, its HTTP checks and the no-vectors walk

**Files:**
- Create: `packages/fixture-server/weave-fixtures.mjs`, `packages/fixture-server/weave-verify.mjs`
- Modify: `packages/fixture-server/server.mjs` (one import, one `CONTRIBUTORS` entry, one reset call)
- Modify: `packages/fixture-server/verify.mjs` (one import, `...WEAVE_INPUT`, one call)
- Test: `packages/plugin-weave/test/fixture-no-vectors.test.ts`

**Interfaces:**
- Produces: `createWeaveHandlers(FixtureError)` returning `{ [intent]: { kind, invalidates?, handler(input) } }`, `resetWeave()`, `WEAVE_IDS`, `idOf(prefix, n)` from `weave-fixtures.mjs`; `WEAVE_INPUT` and `verifyWeave({ dispatch, getCSRF, failures, base })` from `weave-verify.mjs`.
- Page tasks don't import the fixture. Their test data is written inline, in the same shapes.

The fixture models the contract slice 3 shipped (weave `5495ebb`), not today's engine and not a forgiving version of it. Read `/Users/rexraphael/Work/xraph/forgery/weave/extension/contract/*.go` when a rule below is unclear; the Go rule wins and you say so in your report. Error texts are copied from the Go handlers and `errors.go`.

Where it differs from the real server on purpose, and the header comment must say each of these:
- Retrieval scores come from word overlap, not embeddings, and the "MMR" retriever is a greedy pick that penalises a second hit from the same document. They exist to produce a real reordering, a left-out list, an orphaned hit and a budget cut-off, not to rank well.
- Chunking is a fixed window of `chunk_size × 4` characters stepping by `(chunk_size − chunk_overlap) × 4`. Offsets are real UTF-8 byte offsets into the trimmed text.
- One seeded chunk of "Shipping FAQ" is trimmed by 48 characters so the span map has a gap to draw, the way the semantic and code chunkers only approximate their offsets.
- Content containing `FIXTURE_FAIL_EMBED` ingests as `failed` with an embedder error, so the failed path can be walked.
- Switches, read on every call: `FIXTURE_WEAVE_EMBEDDER=none` takes the embedder away (retrieval, ingest and reindex answer `UNAVAILABLE`); `FIXTURE_WEAVE_RETRIEVER=none` takes the retriever away (both sides are the same search); `FIXTURE_WEAVE_REINDEX=fail` makes every reindex answer `INTERNAL` after it started.

- [ ] **Step 1: Write `weave-fixtures.mjs`**

```js
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
        const c = getCollection(input)
        if (typeof input?.name === "string") {
          const name = input.name.trim()
          if (name === "") throw badRequest("collection name cannot be blank")
          if (nameTaken(name, c.tenant_id, c.id)) throw conflict("a collection with this name already exists")
          c.name = name
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
```

The order of the keys in the returned object is the order `verify.mjs` walks them: every query, then the writes that need their targets to exist (`collections.update` on `scratch`, `collections.reindex` on `support-articles`, `documents.ingest`, `documents.delete` on `Holiday hours`), then `collections.delete` on `scratch`, then retrieval. Keep that order.

Cross-check every `invalidates` list against `/Users/rexraphael/Work/xraph/forgery/weave/extension/contract/manifest.yaml`. They must be identical, and `retrieval.run` and `retrieval.assemble` have none.

- [ ] **Step 2: Write `weave-verify.mjs`**

```js
// weave-verify.mjs: weave's inputs for verify.mjs's walk, and the rules the
// Go handlers enforce, checked over HTTP rather than "it answered".
// verify.mjs carries an import, `...WEAVE_INPUT` and one call; everything
// else lives here so weave never edits the shared file twice.
import { WEAVE_IDS as I } from "./weave-fixtures.mjs"

/** Inputs keyed "weave::<intent>". A missing key sends {}. */
export const WEAVE_INPUT = {
  "weave::collections.get": { id: I.support },
  "weave::documents.get": { id: I.refund },
  "weave::documents.spans": { id: I.shipping },
  "weave::chunks.list": { collection_id: I.support },
  "weave::chunks.get": { id: I.firstChunk },
  "weave::collections.create": { name: "verify-weave", chunk_size: 128, chunk_overlap: 16, metadata: { source: "verify" } },
  "weave::collections.update": { id: I.scratch, name: "scratch-renamed", metadata: {} },
  "weave::collections.reindex": { id: I.support },
  "weave::documents.ingest": { collection_id: I.support, title: "Verify note", source_type: "text/plain", content: "Verify note: gift wrapping costs 3 euros and is added at checkout." },
  "weave::documents.delete": { id: I.draft },
  "weave::collections.delete": { id: I.scratch },
  "weave::retrieval.run": { query: "how long does a refund take" },
  "weave::retrieval.assemble": { hits: [{ chunk_id: I.firstChunk, content: "Refunds are issued within 14 days.", score: 0.8 }, { chunk_id: "", content: null, score: 0.5 }], max_tokens: 0 },
}

/** Every key in a value, at any depth. */
function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out)
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysOf(v, out)
    }
  }
  return out
}

export async function verifyWeave({ dispatch, getCSRF, failures, base }) {
  // The walk above wrote and deleted. Start from the seed so every answer
  // below is the seed's.
  await fetch(`${base}/_fixture/reset`, { method: "POST" })
  const csrf = await getCSRF()
  const q = (intent, input = {}) => dispatch("weave", intent, "query", input, csrf)
  const c = (intent, input = {}) => dispatch("weave", intent, "command", input, csrf)
  const check = (name, ok, detail) => {
    ok = Boolean(ok)
    console.log(`  weave ${name}: ${ok}`)
    if (!ok) failures.push({ key: `spot-check::weave ${name}`, reason: typeof detail === "string" ? detail : JSON.stringify(detail) })
  }
  const data = (r) => r.body?.data
  const code = (r) => r.body?.error?.code
  const ids = (r) => (data(r)?.items ?? []).map((x) => x.id).sort()

  // Tenant: absent is every tenant, "" is only untenanted, a name is exact.
  const all = await q("collections.list")
  const none = await q("collections.list", { tenant: "" })
  const acme = await q("collections.list", { tenant: "acme" })
  check("no tenant field lists every tenant", ids(all).join() === [I.support, I.handbook, I.scratch].sort().join(), all.body)
  check('tenant "" lists only untenanted collections', ids(none).join() === [I.support, I.scratch].sort().join(), none.body)
  check('tenant "acme" lists only acme\'s collection', ids(acme).join() === I.handbook, acme.body)

  // Lists: newest first, clamped and echoed, negative refused.
  const clamped = await q("documents.list", { limit: 500 })
  check("a limit over 100 is clamped and echoed", data(clamped)?.limit === 100, clamped.body)
  check("a negative offset is BAD_REQUEST", code(await q("documents.list", { offset: -1 })) === "BAD_REQUEST")
  check("an unknown state is BAD_REQUEST", code(await q("documents.list", { state: "done" })) === "BAD_REQUEST")
  const gone = await q("documents.list", { collection_id: I.missingCollection })
  check("a collection that parses but doesn't exist is an empty page", data(gone)?.total === 0 && data(gone)?.items.length === 0, gone.body)
  check("chunks.list with no scope is BAD_REQUEST", code(await q("chunks.list")) === "BAD_REQUEST")
  check("a malformed ID is BAD_REQUEST", code(await q("documents.get", { id: "doc_nope" })) === "BAD_REQUEST")
  check("a missing document is NOT_FOUND", code(await q("documents.get", { id: I.missingDocument })) === "NOT_FOUND")

  // The states the page has to draw.
  const overview = await q("system.overview")
  check("the overview counts one stalled document", data(overview)?.stalled === 1, overview.body)
  const failed = await q("documents.get", { id: I.warranty })
  check("a failed document carries its stored error", data(failed)?.state === "failed" && typeof data(failed)?.error === "string", failed.body)
  const failedChunks = await q("chunks.list", { document_id: I.warranty })
  check("a vector upsert failure leaves its chunk rows", data(failedChunks)?.total === 2, failedChunks.body)
  const orphan = await q("chunks.get", { id: I.orphanChunk })
  check("a chunk whose document is gone opens with an empty title", data(orphan)?.document_title === "", orphan.body)
  const spans = await q("documents.spans", { id: I.shipping })
  const s = data(spans)?.spans ?? []
  check("the shipping spans have a gap to draw", s.some((x, i) => i > 0 && x.start_offset > s[i - 1].end_offset), spans.body)

  // Writes change the next read.
  const before = data(await q("documents.list", { collection_id: I.support }))?.total
  const ingest = await c("documents.ingest", { collection_id: I.support, title: "Spot check", content: "Spot check: parcels to islands take two extra days." })
  const after = data(await q("documents.list", { collection_id: I.support }))?.total
  check("an ingest answers ready with its chunk count", data(ingest)?.state === "ready" && data(ingest)?.chunk_count > 0, ingest.body)
  check("an ingest grows the list", after === before + 1, { before, after })
  const dup = await c("documents.ingest", { collection_id: I.support, content: "Spot check: parcels to islands take two extra days." })
  check("the same content again is CONFLICT naming a failed or stalled copy", code(dup) === "CONFLICT" && dup.body?.error?.message.includes("failed or stalled"), dup.body)
  const failing = await c("documents.ingest", { collection_id: I.support, content: "FIXTURE_FAIL_EMBED spot check" })
  check("a failed ingest is an answer, not an error", data(failing)?.state === "failed" && data(failing)?.chunk_count === 0 && typeof data(failing)?.error === "string", failing.body)
  const tenanted = await c("documents.ingest", { collection_id: I.handbook, content: "Spot check: badges are collected from reception." })
  const acmeDocs = await q("documents.list", { tenant: "acme" })
  const untenanted = await q("documents.list", { tenant: "" })
  const docId = data(tenanted)?.document_id
  check("an ingest lands in the collection's tenant", ids(acmeDocs).includes(docId) && !ids(untenanted).includes(docId), { acme: ids(acmeDocs), none: ids(untenanted) })
  await c("documents.delete", { id: docId })
  check("a delete shrinks the list", !ids(await q("documents.list", { tenant: "acme" })).includes(docId))

  // Collections: the effective-value message, per-tenant names, rename invalidation.
  const overlap = await c("collections.create", { name: "too-small", chunk_size: 40 })
  check("an overlap refusal names the effective values", overlap.body?.error?.message === "chunk overlap 50 (the default) must be smaller than chunk size 40", overlap.body)
  check("a duplicate name in the same tenant is CONFLICT", code(await c("collections.create", { name: "support-articles" })) === "CONFLICT")
  const blank = await c("collections.update", { id: I.scratch, name: "   " })
  check("a blank rename is BAD_REQUEST", code(blank) === "BAD_REQUEST", blank.body)
  const rename = await c("collections.update", { id: I.scratch, name: "scratch-two" })
  check("a rename invalidates the document views and the overview", ["documents.list", "documents.get", "system.overview"].every((i) => rename.body?.meta?.invalidates?.includes(i)), rename.body?.meta)

  // Retrieval.
  const run = await c("retrieval.run", { query: "refund parcel store credit", top_k: 5, max_tokens: 60 })
  const result = data(run)?.result
  const context = data(run)?.context
  const keys = keysOf(data(run))
  check("a run carries no vector or embedding key", !["vector", "vectors", "embedding", "embeddings"].some((k) => keys.has(k)), [...keys])
  check("a run has hits and an orphaned one among hits or left out", result?.hits.length > 0 && [...result.hits, ...result.left_out].some((h) => h.orphaned), result)
  check("a run reorders and leaves something out", result?.reordered === true && result?.left_out.length > 0, result)
  check("a small budget cuts the context off", context?.first_excluded >= 0, context)
  const echoed = result.hits.map((h) => ({ chunk_id: h.chunk?.id ?? "", content: h.chunk ? h.chunk.content : null, score: h.score }))
  const again = await c("retrieval.assemble", { hits: echoed, max_tokens: 60 })
  check("re-assembling the same hits gives the same context", data(again)?.context === context?.context && JSON.stringify(data(again)?.included) === JSON.stringify(context?.included), data(again))
  check("an empty query is BAD_REQUEST", code(await c("retrieval.run", { query: "  " })) === "BAD_REQUEST")
  check("51 hits is BAD_REQUEST", code(await c("retrieval.assemble", { hits: Array.from({ length: 51 }, () => ({ chunk_id: "", content: "x", score: 0 })) })) === "BAD_REQUEST")

  await fetch(`${base}/_fixture/reset`, { method: "POST" })
}
```

- [ ] **Step 3: Register the contributor and the checks**

Read the current `server.mjs` and `verify.mjs` first; other sessions edit both. Check `git diff packages/fixture-server/server.mjs packages/fixture-server/verify.mjs` so you know which lines are theirs. Use the Edit tool only.

In `server.mjs`, add next to the other fixture imports:

```js
import { createWeaveHandlers, resetWeave } from "./weave-fixtures.mjs"
```

add to `CONTRIBUTORS` after the herald entry:

```js
  { name: "weave", envPrefix: "WEAVE", handlers: createWeaveHandlers(FixtureError) },
```

and add `resetWeave()` in the reset handler after `resetHerald()`.

In `verify.mjs`, add next to the herald import:

```js
import { WEAVE_INPUT, verifyWeave } from "./weave-verify.mjs"
```

add `...WEAVE_INPUT,` to `INPUT` after `...HERALD_INPUT,`, and after `await verifyHerald({ dispatch, getCSRF, failures })` add:

```js
  await verifyWeave({ dispatch, getCSRF, failures, base })
```

Every line you add contains the word `weave` or `Weave`, which is what the commit helper keys on.

- [ ] **Step 4: Write the no-vectors walk in the plugin's tests**

`packages/plugin-weave/test/fixture-no-vectors.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest"

// The fixture is plain .mjs with no types, and it is a dev tool rather than a
// shipped module, so the imports below carry no declaration and are cast.

class FixtureError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Handler = { kind: string; handler: (input: Record<string, unknown>) => unknown }
type Fixture = {
  createWeaveHandlers: (e: typeof FixtureError) => Record<string, Handler>
  resetWeave: () => void
}
type Verify = { WEAVE_INPUT: Record<string, Record<string, unknown>> }

let fixture: Fixture
let verify: Verify

beforeEach(async () => {
  // @ts-expect-error TS7016: weave-fixtures.mjs has no declaration file.
  fixture = (await import("../../fixture-server/weave-fixtures.mjs")) as Fixture
  // @ts-expect-error TS7016: weave-verify.mjs has no declaration file.
  verify = (await import("../../fixture-server/weave-verify.mjs")) as Verify
  fixture.resetWeave()
})

const FORBIDDEN = new Set(["vector", "vectors", "embedding", "embeddings"])

/** Every forbidden key, and every numeric array long enough to be an embedding. */
function leaks(value: unknown, path: string, out: string[]): string[] {
  if (Array.isArray(value)) {
    if (value.length > 64 && value.every((v) => typeof v === "number")) out.push(`${path}: ${value.length} numbers`)
    value.forEach((v, i) => leaks(v, `${path}[${i}]`, out))
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k.toLowerCase())) out.push(`${path}.${k}`)
      leaks(v, `${path}.${k}`, out)
    }
  }
  return out
}

describe("the weave fixture", () => {
  it("answers every intent the contract declares", () => {
    const handlers = fixture.createWeaveHandlers(FixtureError)
    expect(Object.keys(handlers).sort()).toEqual(
      [
        "chunks.get", "chunks.list", "collections.create", "collections.delete", "collections.get",
        "collections.list", "collections.reindex", "collections.update", "documents.delete",
        "documents.get", "documents.ingest", "documents.list", "documents.spans",
        "retrieval.assemble", "retrieval.run", "system.components", "system.overview",
      ].sort(),
    )
  })

  it("never answers with a vector or an embedding", () => {
    const handlers = fixture.createWeaveHandlers(FixtureError)
    const found: string[] = []
    for (const [intent, h] of Object.entries(handlers)) {
      const out = h.handler(verify.WEAVE_INPUT[`weave::${intent}`] ?? {})
      leaks(out, intent, found)
    }
    expect(found).toEqual([])
  })
})
```

- [ ] **Step 5: Run the fixture server, the verifier and the plugin test**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
FIXTURE_PORT=8299 node packages/fixture-server/server.mjs > "$W/weave-fixture.log" 2>&1 &
sleep 1
node packages/fixture-server/verify.mjs http://localhost:8299 > "$W/weave-verify.log" 2>&1
grep -E "weave|Passed|Failed" "$W/weave-verify.log" | tail -60
kill %1
pnpm --filter @forge-go/dashboard-plugin-weave test
```

The shipping text is about 470 characters, so it makes three chunks at the seeded size; trimming the middle one by 48 characters leaves a 16 byte gap before the third. If you change a seeded text, recount so the gap survives. If a spot check about the run's shape (reordered, left out, orphaned) fails because the word-overlap scores happen to put every strong match inside the final five, change the query in the spot check, not the fixture's rules, and say so.

Check how the other fixture switches are read before you start the server (search `server.mjs` for `FIXTURE_PORT` and `process.argv`) and use the same port mechanism if it differs. Expected: every `weave::` intent passes, every `weave` spot check prints `true`, and the plugin tests pass. Failures in other contributors are not yours: record the ones that don't mention weave and don't fix them. If a `weave::` walk entry fails because of order, fix the input in `WEAVE_INPUT`, not the fixture.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/test/fixture-no-vectors.test.ts
bash "$W/commit-mine.sh" \
  -m "feat(fixture-server): add the weave fixture for all 17 intents" \
  -m "<body>" \
  --whole packages/fixture-server/weave-fixtures.mjs packages/fixture-server/weave-verify.mjs packages/plugin-weave/test/fixture-no-vectors.test.ts \
  --shared packages/fixture-server/server.mjs:eave packages/fixture-server/verify.mjs:eave
git show HEAD -- packages/fixture-server/server.mjs packages/fixture-server/verify.mjs
```

The needle `eave` matches both `weave` and `Weave`. Confirm every committed hunk in the two shared files is yours. Body, for example: the fixture models the contract slice 3 shipped, including the orphaned hit, the stalled and failed documents and the duplicate refusal, and `weave-verify.mjs` checks those rules over HTTP so the shared verifier only gains three lines.

---
### Task 3: Overview page and the shared document columns

**Files:**
- Create: `packages/plugin-weave/src/components/document-columns.tsx`, `src/pages/overview.tsx`
- Modify: `packages/plugin-weave/src/index.tsx` (nav entry and route)
- Test: `packages/plugin-weave/test/overview.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `Overview`, `DocumentRow`, `Components` (types); `DocumentStateCell`; `IdLink`; `collectionPath`, `documentPath`; `formatAge`, `formatBytes`, `formatCount`, `plural` from Task 1.
- Produces: `documentColumns({ withCollection }: { withCollection: boolean }): Column<DocumentRow>[]` from `src/components/document-columns.tsx` (Tasks 7 and 9 use it); `ComponentsStrip({ components })` exported from `src/pages/overview.tsx`; `OverviewPage`.

- [ ] **Step 1: Write the failing tests**

`test/overview.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"

const COMPONENTS = {
  loader: { kind: "text", configured: true, content_types: ["text/plain"] },
  chunker: { kind: "recursive", configured: true },
  embedder: { kind: "", configured: false },
  vector_store: { kind: "memory", score: "cosine", tenant_filter: "verified", configured: true },
  retriever: { kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, configured: true },
  score: "mmr_relevance",
  tenant_filter: "verified",
}

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-07T09:00:00Z",
    updated_at: "2026-10-07T09:00:00Z",
    id: "doc_01k70000000000000000000001",
    collection_id: "col_01k70000000000000000000001",
    tenant_id: "",
    title: "Refund policy",
    content_hash: "ab".repeat(32),
    content_length: 4812,
    chunk_count: 6,
    metadata: {},
    state: "ready",
    collection_name: "support-articles",
    stalled: false,
    ...over,
  }
}

function overview(over: Record<string, unknown> = {}) {
  return {
    collections: 3,
    documents: 6,
    documents_by_state: { pending: 1, processing: 1, ready: 3, failed: 1 },
    chunks: 21,
    stalled: 1,
    stalled_after_seconds: 900,
    newest_documents: [
      doc(),
      doc({ id: "doc_01k70000000000000000000004", title: "Returns archive 2019", state: "processing", stalled: true, updated_at: "2026-10-07T06:00:00Z" }),
      doc({ id: "doc_01k70000000000000000000003", title: undefined, state: "failed", collection_name: "" }),
    ],
    components: COMPONENTS,
    scope: "all",
    ...over,
  }
}

function rowWith(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("OverviewPage", () => {
  it("asks system.overview with no tenant, because the dashboard sees every tenant", async () => {
    const { client, sent } = recordingQueryClient({ "system.overview": overview() })
    renderPage(OverviewPage, client)
    await screen.findByText("Refund policy")
    expect(sent.find((s) => s.intent === "system.overview")?.params).toEqual({})
    expect(screen.getByText(/sees every tenant's data/)).toBeTruthy()
  })

  it("counts collections, documents by state, chunks and stalled documents", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview() }))
    await screen.findByText("Refund policy")
    expect(screen.getByText("Looks stalled")).toBeTruthy()
    expect(screen.getByText(/processing with no update for 15 min/)).toBeTruthy()
    expect(screen.getByText("Failed")).toBeTruthy()
    expect(screen.getByText("21")).toBeTruthy()
  })

  it("lists the newest documents with the five conventions", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview() }))
    const title = await screen.findByText("Refund policy")
    expect(title.className).toContain("font-medium")
    expect(screen.getByText("doc_01k70000000000000000000001").className).toContain("font-mono")
    expect(screen.getByText("3 newest documents")).toBeTruthy()
    expect(within(rowWith("Returns archive 2019")).getByText(/no update for/)).toBeTruthy()
    const failed = rowWith("failed")
    expect(within(failed).getByLabelText("no title")).toBeTruthy()
    expect(within(failed).getByText("deleted collection")).toBeTruthy()
  })

  it("says so when there are no documents yet", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview({ newest_documents: [], documents: 0 }) }))
    expect(await screen.findByText("0 newest documents")).toBeTruthy()
    expect(screen.getByText(/No documents yet/)).toBeTruthy()
  })

  it("names each stage it runs and says which are not configured", async () => {
    renderPage(OverviewPage, stubClient({ "system.overview": overview() }))
    await screen.findByText("Refund policy")
    expect(screen.getByText("mmr").className).toContain("font-mono")
    expect(screen.getByLabelText("no embedder")).toBeTruthy()
    expect(screen.getByRole("link", { name: /pipeline/i }).getAttribute("href")).toBe("/pipeline")
  })

  it("shows an error card when the overview cannot be read", async () => {
    renderPage(OverviewPage, failingClient(new ContractError("UNAVAILABLE", "Weave has no metadata store configured")))
    expect(await screen.findByText(/no metadata store configured/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Overview first in the RAG group at /", () => {
    const overview = weavePlugin.nav?.find((n) => n.label === "Overview")
    expect(overview?.to).toBe("/")
    expect(overview?.group).toBe("RAG")
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, `../src/pages/overview` not found and no Overview nav entry.

- [ ] **Step 3: Write the shared document columns**

`src/components/document-columns.tsx`:

```tsx
import { PluginLink } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import type { Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { DocumentStateCell } from "../badges"
import { formatBytes, formatCount } from "../format"
import { collectionPath, documentPath } from "../links"
import type { DocumentRow } from "../types"
import { IdLink } from "./id"

/**
 * The columns every document table shares: Overview's newest documents,
 * a collection's documents, and the Documents page. A collection's own page
 * leaves the collection column out, because every row would say the same.
 */
export function documentColumns({ withCollection }: { withCollection: boolean }): Column<DocumentRow>[] {
  const columns: Column<DocumentRow>[] = [
    {
      id: "title",
      header: "Title",
      className: "font-medium",
      cell: (d) =>
        d.title ? (
          <PluginLink to={documentPath(d.id)} className="font-medium underline-offset-4 hover:underline">
            {d.title}
          </PluginLink>
        ) : (
          <NoneCell label="title" />
        ),
    },
    { id: "id", header: "ID", cell: (d) => <IdLink to={documentPath(d.id)} value={d.id} label={`Open document ${d.id}`} /> },
  ]
  if (withCollection) {
    columns.push({
      id: "collection",
      header: "Collection",
      cell: (d) =>
        d.collection_name !== "" ? (
          <PluginLink to={collectionPath(d.collection_id)} className="underline-offset-4 hover:underline">
            {d.collection_name}
          </PluginLink>
        ) : (
          <span className="text-sm text-muted-foreground">deleted collection</span>
        ),
    })
  }
  columns.push(
    { id: "state", header: "State", cell: (d) => <DocumentStateCell doc={d} /> },
    { id: "chunks", header: "Chunks", align: "end", cell: (d) => <span className="tabular-nums">{formatCount(d.chunk_count)}</span> },
    { id: "size", header: "Size", align: "end", cell: (d) => <span className="font-mono text-xs tabular-nums">{formatBytes(d.content_length)}</span> },
    { id: "updated", header: "Updated", cell: (d) => <Timestamp value={d.updated_at} label="update" /> },
  )
  return columns
}
```

The title cell carries `font-medium` on the link itself, because the test reads the class off the element holding the text.

- [ ] **Step 4: Write the page**

`src/pages/overview.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { documentColumns } from "../components/document-columns"
import { formatAge, formatCount, plural } from "../format"
import type { Components, DocumentRow, Overview } from "../types"

const STAGES: { key: keyof Pick<Components, "loader" | "chunker" | "embedder" | "vector_store" | "retriever">; label: string; none: string }[] = [
  { key: "loader", label: "Loader", none: "loader" },
  { key: "chunker", label: "Chunker", none: "chunker" },
  { key: "embedder", label: "Embedder", none: "embedder" },
  { key: "vector_store", label: "Vector store", none: "vector store" },
  { key: "retriever", label: "Retriever", none: "retriever" },
]

/** One line naming what each stage runs. Pipeline has the detail. */
export function ComponentsStrip({ components }: { components: Components }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {STAGES.map((s) => {
        const c = components[s.key]
        return (
          <span key={s.key} className="inline-flex items-center gap-2">
            <span className="text-muted-foreground">{s.label}</span>
            {c.configured && c.kind !== "" ? <span className="font-mono text-xs">{c.kind}</span> : <NoneCell label={s.none} />}
          </span>
        )
      })}
      <PluginLink to="/pipeline" className="underline-offset-4 hover:underline">
        See the pipeline
      </PluginLink>
    </div>
  )
}

const columns = documentColumns({ withCollection: true })

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const overview = useQuery<Overview>("system.overview", {})

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="What Weave holds and what it runs. This dashboard sees every tenant's data."
      />
      <QueryBoundary title="Overview" query={overview} skeletonRows={6}>
        {(data) => (
          <>
            <StatGrid
              items={[
                { label: "Collections", value: formatCount(data.collections) },
                { label: "Documents", value: formatCount(data.documents) },
                { label: "Chunks", value: formatCount(data.chunks) },
                { label: "Ready", value: formatCount(data.documents_by_state.ready) },
                { label: "Pending", value: formatCount(data.documents_by_state.pending) },
                { label: "Processing", value: formatCount(data.documents_by_state.processing) },
                {
                  label: "Failed",
                  value: formatCount(data.documents_by_state.failed),
                  tone: data.documents_by_state.failed > 0 ? "danger" : "default",
                },
                {
                  label: "Looks stalled",
                  value: formatCount(data.stalled),
                  hint: `processing with no update for ${formatAge(data.stalled_after_seconds)}`,
                  tone: data.stalled > 0 ? "warning" : "default",
                },
              ]}
            />
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">What runs</h2>
              <ComponentsStrip components={data.components} />
            </section>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Newest documents</h2>
              <ResourceTable<DocumentRow>
                columns={columns}
                rows={data.newest_documents}
                rowKey={(d) => d.id}
                caption={plural(data.newest_documents.length, "newest document", "newest documents")}
                emptyMessage="No documents yet. Open a collection and ingest one."
                emptyAction={
                  <PluginLink to="/collections" className="underline-offset-4 hover:underline">
                    Open collections
                  </PluginLink>
                }
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

`StatGrid` renders every value it is handed; the counts go through `formatCount` so 1,200 reads with its comma. If the "21" assertion collides with another rendered "21", change the seeded chunk count to a number nothing else shows, not the assertion's intent.

- [ ] **Step 5: Register the page**

In `src/index.tsx`, import `HouseIcon` from `@forge-go/dashboard-kit/icons` and `OverviewPage` from `./pages/overview`, export `OverviewPage`, and set:

```tsx
  nav: [{ label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "RAG" }],
  routes: [{ path: "/", element: OverviewPage }],
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/components/document-columns.tsx packages/plugin-weave/src/pages/overview.tsx packages/plugin-weave/test/overview.test.tsx
git commit --only -m "feat(plugin-weave): add the overview page" -m "<body>" -- packages/plugin-weave/src/components/document-columns.tsx packages/plugin-weave/src/pages/overview.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/overview.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: the overview counts documents by state, says how many look stalled and after how long, lists the ten newest documents newest first, and names each stage Weave runs.

---

### Task 4: Pipeline page and the score wording

**Files:**
- Create: `packages/plugin-weave/src/score.ts`, `src/pages/pipeline.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/score.test.ts`, `test/pipeline.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `Components`, `ComponentsOutput`, `PipelineComponent`, `ScoreKind`, `ExtensionInfo` (types); `plural`, `formatCount` from Task 1.
- Produces (Task 13 imports these): `scoreHeader(kind: ScoreKind | undefined): string`, `scoreMeaning(kind: ScoreKind | undefined): string`, `retrieverSentence(c: Components): string`, `isReorderingRetriever(c: Components): boolean` from `src/score.ts`; `PipelinePage`.

- [ ] **Step 1: Write the failing tests**

`test/score.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isReorderingRetriever, retrieverSentence, scoreHeader, scoreMeaning } from "../src/score"
import type { Components } from "../src/types"

function components(retriever: Components["retriever"]): Components {
  return {
    loader: { kind: "text", configured: true },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true },
    vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever,
    score: retriever.score ?? "cosine",
    tenant_filter: "verified",
  }
}

describe("scoreHeader", () => {
  it("names the column for what the score is", () => {
    expect(scoreHeader("cosine")).toBe("Cosine")
    expect(scoreHeader("mmr_relevance")).toBe("Cosine")
    expect(scoreHeader("rrf")).toBe("RRF score")
    expect(scoreHeader("rerank")).toBe("Rerank score")
    expect(scoreHeader("vector_similarity")).toBe("Similarity")
    expect(scoreHeader("unknown")).toBe("Score")
    expect(scoreHeader(undefined)).toBe("Score")
  })
})

describe("scoreMeaning", () => {
  it("says an RRF sum is not cosine and an unknown score is unknown", () => {
    expect(scoreMeaning("rrf")).toMatch(/not comparable to cosine/)
    expect(scoreMeaning("unknown")).toMatch(/can't tell/)
  })
})

describe("retrieverSentence", () => {
  it("names MMR with its lambda", () => {
    expect(retrieverSentence(components({ kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, configured: true }))).toBe(
      "MMR retriever (λ 0.70). Scores are cosine relevance, and the order is MMR.",
    )
  })

  it("says plainly when no retriever is configured", () => {
    expect(retrieverSentence(components({ kind: "", configured: false }))).toBe(
      "No retriever is configured, so Weave returns the vector search as it is. Scores are cosine similarity.",
    )
  })

  it("names hybrid with its k and a custom retriever by kind", () => {
    expect(retrieverSentence(components({ kind: "hybrid", score: "rrf", params: { k: "60" }, configured: true }))).toMatch(/^Hybrid retriever \(k 60\)/)
    expect(retrieverSentence(components({ kind: "custom", score: "unknown", configured: true }))).toBe(
      "A custom retriever. Weave can't tell what its scores mean.",
    )
  })
})

describe("isReorderingRetriever", () => {
  it("is false with no retriever or a similarity one, true otherwise", () => {
    expect(isReorderingRetriever(components({ kind: "", configured: false }))).toBe(false)
    expect(isReorderingRetriever(components({ kind: "similarity", configured: true }))).toBe(false)
    expect(isReorderingRetriever(components({ kind: "mmr", configured: true }))).toBe(true)
  })
})
```

`test/pipeline.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { PipelinePage } from "../src/pages/pipeline"
import { failingClient, renderPage, stubClient } from "./harness"

function output(over: Record<string, unknown> = {}) {
  return {
    components: {
      loader: { kind: "text", type: "*loader.TextLoader", configured: true, content_types: ["text/plain", "text/html"] },
      chunker: { kind: "semantic", params: { offsets: "approximate" }, type: "*chunker.SemanticChunker", configured: true },
      embedder: { kind: "openai", params: { model: "text-embedding-3-small" }, type: "*embedder.OpenAIEmbedder", configured: true, dimensions: 1536 },
      vector_store: { kind: "fabriq", score: "vector_similarity", tenant_filter: "unverified", configured: true },
      retriever: { kind: "", configured: false },
      score: "vector_similarity",
      tenant_filter: "unverified",
    },
    config: {
      default_chunk_size: 512,
      default_chunk_overlap: 50,
      default_embedding_model: "text-embedding-3-small",
      default_chunk_strategy: "recursive",
      default_top_k: 10,
      shutdown_timeout_seconds: 30,
    },
    extensions: [
      { name: "audit-trail", hooks: ["ingest_completed", "ingest_failed"] },
      { name: "metrics", hooks: [] },
    ],
    ...over,
  }
}

function rowWith(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("PipelinePage", () => {
  it("asks system.components with no parameters", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("Loader")).toBeTruthy()
  })

  it("shows each stage's kind, parameters and Go type", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    const embedder = rowWith("Embedder")
    expect(within(embedder).getByText("openai").className).toContain("font-mono")
    expect(within(embedder).getByText("model=text-embedding-3-small")).toBeTruthy()
    expect(within(embedder).getByText("dimensions=1536")).toBeTruthy()
    expect(within(rowWith("Chunker")).getByText("offsets=approximate")).toBeTruthy()
  })

  it("says what an absent retriever means rather than calling it inactive", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    await screen.findByText("Loader")
    expect(within(rowWith("Retriever")).getByText(/returns the vector search as it is/)).toBeTruthy()
  })

  it("says tenant filtering on this store is unverified", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText(/can't check tenant filtering on this vector store/)).toBeTruthy()
  })

  it("lists the content types the loader actually supports", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("text/html")).toBeTruthy()
  })

  it("shows the engine config and says the recorded defaults are never read back", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("512 tokens")).toBeTruthy()
    expect(screen.getAllByText(/never read back/).length).toBeGreaterThan(0)
  })

  it("lists extensions with their hooks, and none for an extension with none", async () => {
    renderPage(PipelinePage, stubClient({ "system.components": output() }))
    expect(await screen.findByText("2 extensions")).toBeTruthy()
    expect(within(rowWith("metrics")).getByLabelText("no hooks")).toBeTruthy()
    expect(within(rowWith("audit-trail")).getByText("ingest_failed")).toBeTruthy()
  })

  it("shows an error card when the report cannot be read", async () => {
    renderPage(PipelinePage, failingClient(new ContractError("INTERNAL", "an internal error occurred")))
    expect(await screen.findByText(/an internal error occurred/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Pipeline last in the RAG group", () => {
    const pipeline = weavePlugin.nav?.find((n) => n.label === "Pipeline")
    expect(pipeline?.to).toBe("/pipeline")
    expect(pipeline?.group).toBe("RAG")
    expect(pipeline?.priority).toBe(40)
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/pipeline")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/score.ts`**

```ts
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
```

- [ ] **Step 4: Write the page**

`src/pages/pipeline.tsx`:

```tsx
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { formatCount, plural } from "../format"
import { retrieverSentence, scoreMeaning } from "../score"
import type { Components, ComponentsOutput, ExtensionInfo, PipelineComponent } from "../types"

interface StageRow {
  key: string
  label: string
  component: PipelineComponent
  /** What it means for this stage to be missing. */
  absent: string
}

function stagesOf(c: Components): StageRow[] {
  return [
    { key: "loader", label: "Loader", component: c.loader, absent: "Not configured." },
    { key: "chunker", label: "Chunker", component: c.chunker, absent: "Not configured, so Weave can't ingest." },
    { key: "embedder", label: "Embedder", component: c.embedder, absent: "Not configured, so Weave can't ingest or search." },
    { key: "vector_store", label: "Vector store", component: c.vector_store, absent: "Not configured, so Weave can't ingest or search." },
    {
      key: "retriever",
      label: "Retriever",
      component: c.retriever,
      absent: "Not configured, so Weave returns the vector search as it is.",
    },
  ]
}

function paramsOf(c: PipelineComponent): string[] {
  const out = Object.keys(c.params ?? {})
    .sort()
    .map((k) => `${k}=${c.params![k]}`)
  if (c.dimensions) out.push(`dimensions=${c.dimensions}`)
  for (const child of c.children ?? []) out.push(`child=${child.kind}`)
  return out
}

const stageColumns: Column<StageRow>[] = [
  { id: "stage", header: "Stage", className: "font-medium", cell: (s) => s.label },
  {
    id: "kind",
    header: "Kind",
    cell: (s) =>
      s.component.configured && s.component.kind !== "" ? (
        <span className="font-mono text-xs">{s.component.kind}</span>
      ) : (
        <span className="text-sm text-muted-foreground">{s.absent}</span>
      ),
  },
  { id: "params", header: "Parameters", cell: (s) => <TagList values={paramsOf(s.component)} label="parameters" /> },
  {
    id: "score",
    header: "Score",
    cell: (s) => (s.component.score ? <span className="text-sm">{scoreMeaning(s.component.score)}</span> : <NoneCell label="score" />),
  },
  {
    id: "type",
    header: "Go type",
    cell: (s) => (s.component.type ? <span className="font-mono text-xs">{s.component.type}</span> : <NoneCell label="type" />),
  },
]

const extensionColumns: Column<ExtensionInfo>[] = [
  { id: "name", header: "Extension", className: "font-medium", cell: (x) => x.name },
  { id: "hooks", header: "Hooks it implements", cell: (x) => <TagList values={x.hooks} label="hooks" /> },
]

export const PipelinePage: ComponentType<PluginPageProps> = () => {
  const report = useQuery<ComponentsOutput>("system.components", {})

  return (
    <section className="flex flex-col gap-6">
      <PageHeader title="Pipeline" description="What this deployment of Weave actually runs, as the engine reports it." />
      <QueryBoundary title="Pipeline" query={report} skeletonRows={6}>
        {(data) => (
          <>
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Stages</h2>
              <p className="text-sm text-muted-foreground">{retrieverSentence(data.components)}</p>
              <ResourceTable<StageRow>
                columns={stageColumns}
                rows={stagesOf(data.components)}
                rowKey={(s) => s.key}
                caption="5 stages"
                emptyMessage="The engine reported no stages."
              />
              <p className="text-sm">
                {data.components.tenant_filter === "verified"
                  ? "Tenant filtering on this vector store is covered by Weave's tests."
                  : "Weave can't check tenant filtering on this vector store, so treat a search filtered by tenant as unverified."}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Content types the loader reads</h2>
              <p className="text-sm text-muted-foreground">Asked of the loader itself, so this is what it accepts, not a list someone wrote down.</p>
              <TagList values={data.components.loader.content_types ?? []} label="content types" />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Engine config</h2>
              <DescriptionList
                items={[
                  { term: "Default chunk size", value: `${formatCount(data.config.default_chunk_size)} tokens` },
                  { term: "Default chunk overlap", value: `${formatCount(data.config.default_chunk_overlap)} tokens` },
                  {
                    term: "Embedding model",
                    value: (
                      <span>
                        <span className="font-mono text-xs">{data.config.default_embedding_model}</span>
                        <span className="text-muted-foreground"> recorded on new collections and never read back</span>
                      </span>
                    ),
                  },
                  {
                    term: "Chunk strategy",
                    value: (
                      <span>
                        <span className="font-mono text-xs">{data.config.default_chunk_strategy}</span>
                        <span className="text-muted-foreground"> recorded on new collections and never read back</span>
                      </span>
                    ),
                  },
                  { term: "Default top K", value: formatCount(data.config.default_top_k) },
                  { term: "Shutdown timeout", value: `${data.config.shutdown_timeout_seconds} s` },
                ]}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">What Weave doesn't do</h2>
              <ul className="list-disc pl-5 text-sm">
                <li>One embedder and one chunker serve every collection. A collection's model, dimensions and strategy are written down when it is made and never used.</li>
                <li>Reindex re-embeds the chunks a collection already has with the current embedder. It never re-chunks.</li>
                <li>Weave keeps a hash and a length of each source, never the source text.</li>
              </ul>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Extensions</h2>
              <ResourceTable<ExtensionInfo>
                columns={extensionColumns}
                rows={data.extensions}
                rowKey={(x) => x.name}
                caption={plural(data.extensions.length, "extension", "extensions")}
                emptyMessage="No extensions are registered."
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

Read `packages/kit/src/components/tag-list.tsx` before relying on it: the tests assume an empty `values` renders a `NoneCell` labelled "no <label>" and each value renders as its own element. If it renders differently, change the page, not the assertion's intent, and say so in your report.

- [ ] **Step 5: Register the page**

In `src/index.tsx`, import `WorkflowIcon` and `PipelinePage`, export `PipelinePage`, and add:

```tsx
    { label: "Pipeline", to: "/pipeline", priority: 40, icon: <WorkflowIcon />, group: "RAG" },
```

to `nav`, and `{ path: "/pipeline", element: PipelinePage }` to `routes`.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/score.ts packages/plugin-weave/src/pages/pipeline.tsx packages/plugin-weave/test/score.test.ts packages/plugin-weave/test/pipeline.test.tsx
git commit --only -m "feat(plugin-weave): add the pipeline page" -m "<body>" -- packages/plugin-weave/src/score.ts packages/plugin-weave/src/pages/pipeline.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/score.test.ts packages/plugin-weave/test/pipeline.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: the pipeline page reports what the engine runs, stage by stage, with what each score means, the content types the loader really accepts, and the defaults Weave records but never reads.

---
### Task 5: Collections page

**Files:**
- Create: `packages/plugin-weave/src/pages/collections.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/collections.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `Collection`, `ListOutput` (types); `withTenant`, `TenantFilter`, `useDebounced`, `pageOf`, `offsetFor`, `PAGE_SIZE`, `Id`, `IdLink`, `collectionPath`, `formatCount`, `plural` from Task 1.
- Produces: `CollectionsPage`.

- [ ] **Step 1: Write the failing tests**

`test/collections.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionsPage } from "../src/pages/collections"
import { failingClient, renderPage, scriptedClient } from "./harness"

function collection(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-09-07T09:00:00Z",
    updated_at: "2026-09-07T09:00:00Z",
    id: "col_01k70000000000000000000001",
    name: "support-articles",
    description: "Help centre articles the support assistant answers from.",
    tenant_id: "",
    app_id: "",
    embedding_model: "text-embedding-3-small",
    embedding_dims: 1536,
    chunk_strategy: "recursive",
    chunk_size: 48,
    chunk_overlap: 8,
    metadata: {},
    document_count: 5,
    chunk_count: 21,
    ...over,
  }
}

const TWO = {
  items: [collection(), collection({ id: "col_01k70000000000000000000002", name: "acme-handbook", description: undefined, tenant_id: "acme", document_count: 1, chunk_count: 2 })],
  total: 2,
  limit: 25,
  offset: 0,
}

function rowWith(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("CollectionsPage", () => {
  it("asks for the first page of every tenant's collections", async () => {
    const { client, queried } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    expect(queried[0]).toEqual({ intent: "collections.list", params: { limit: 25, offset: 0 } })
  })

  it("shows each collection with live counts and the five conventions", async () => {
    const { client } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    const name = await screen.findByText("support-articles")
    expect(name.className).toContain("font-medium")
    expect(screen.getByText("2 collections")).toBeTruthy()
    const support = rowWith("support-articles")
    expect(within(support).getByText("col_01k70000000000000000000001").className).toContain("font-mono")
    expect(within(support).getByLabelText("no tenant")).toBeTruthy()
    expect(within(support).getByText("21")).toBeTruthy()
    expect(within(support).getByText("48 / 8")).toBeTruthy()
    expect(within(rowWith("acme-handbook")).getByText("acme").className).toContain("font-mono")
  })

  it("searches by name after typing stops, from the first page", async () => {
    const { client, queried } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    fireEvent.change(screen.getByLabelText("Search collections"), { target: { value: " acme " } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, search: "acme" }))
  })

  it("sends tenant only when one is picked", async () => {
    const { client, queried } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "none" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, tenant: "" }))
  })

  it("pages with the limit the server applied", async () => {
    const { client, queried } = scriptedClient({
      "collections.list": (input: Record<string, unknown>) => ({ ...TWO, total: 30, offset: input.offset as number }),
    })
    renderPage(CollectionsPage, client)
    await screen.findByText("Page 1 of 2, 30 total")
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 25 }))
  })

  it("says nothing exists yet, and offers to create one", async () => {
    const { client } = scriptedClient({ "collections.list": { items: [], total: 0, limit: 25, offset: 0 } })
    renderPage(CollectionsPage, client)
    expect(await screen.findByText("0 collections")).toBeTruthy()
    expect(screen.getByText(/No collections yet/)).toBeTruthy()
  })

  it("says the filters matched nothing when it was filtered", async () => {
    const { client } = scriptedClient({ "collections.list": { items: [], total: 0, limit: 25, offset: 0 } })
    renderPage(CollectionsPage, client)
    await screen.findByText("0 collections")
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "none" } })
    expect(await screen.findByText(/No collections match these filters/)).toBeTruthy()
  })

  it("links to the create form", async () => {
    const { client } = scriptedClient({ "collections.list": TWO })
    renderPage(CollectionsPage, client)
    await screen.findByText("support-articles")
    expect(screen.getByRole("link", { name: "New collection" }).getAttribute("href")).toBe("/collections/new")
  })

  it("shows an error card when the list cannot be read", async () => {
    renderPage(CollectionsPage, failingClient(new ContractError("BAD_REQUEST", "limit and offset cannot be negative")))
    expect(await screen.findByText(/cannot be negative/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Collections third in the RAG group", () => {
    const nav = weavePlugin.nav?.find((n) => n.label === "Collections")
    expect(nav?.to).toBe("/collections")
    expect(nav?.priority).toBe(10)
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/collections")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the page**

`src/pages/collections.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { Id, IdLink } from "../components/id"
import { TenantFilter } from "../components/tenant-filter"
import { formatCount, plural } from "../format"
import { collectionPath } from "../links"
import { PAGE_SIZE, offsetFor, pageOf } from "../paging"
import { withTenant } from "../tenant"
import type { Collection, ListOutput } from "../types"
import { useDebounced } from "../use-debounced"

const columns: Column<Collection>[] = [
  {
    id: "name",
    header: "Name",
    className: "font-medium",
    cell: (c) => (
      <div className="flex flex-col">
        <PluginLink to={collectionPath(c.id)} className="font-medium underline-offset-4 hover:underline">
          {c.name}
        </PluginLink>
        {c.description ? <span className="text-xs text-muted-foreground">{c.description}</span> : null}
      </div>
    ),
  },
  { id: "id", header: "ID", cell: (c) => <IdLink to={collectionPath(c.id)} value={c.id} label={`Open collection ${c.id}`} /> },
  { id: "tenant", header: "Tenant", cell: (c) => (c.tenant_id !== "" ? <Id value={c.tenant_id} /> : <NoneCell label="tenant" />) },
  { id: "documents", header: "Documents", align: "end", cell: (c) => <span className="tabular-nums">{formatCount(c.document_count)}</span> },
  { id: "chunks", header: "Chunks", align: "end", cell: (c) => <span className="tabular-nums">{formatCount(c.chunk_count)}</span> },
  {
    id: "chunking",
    header: "Size / overlap",
    cell: (c) => (
      <span className="font-mono text-xs tabular-nums" title="Chunk size and overlap, in tokens">
        {c.chunk_size} / {c.chunk_overlap}
      </span>
    ),
  },
  { id: "created", header: "Created", cell: (c) => <Timestamp value={c.created_at} label="creation date" /> },
]

export const CollectionsPage: ComponentType<PluginPageProps> = () => {
  const [search, setSearch] = useState("")
  const [tenant, setTenant] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  const term = useDebounced(search.trim(), 300)

  const params = withTenant({ limit: PAGE_SIZE, offset, ...(term !== "" ? { search: term } : {}) }, tenant)
  const list = useQuery<ListOutput<Collection>>("collections.list", params)
  const filtered = term !== "" || tenant !== null

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Collections"
        description="Each collection chunks and embeds its documents with the size and overlap it was created with. Counts are live."
        actions={
          <PluginLink to="/collections/new" className={buttonVariants()}>
            New collection
          </PluginLink>
        }
      />
      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setOffset(0)
          },
          placeholder: "Search by name",
          label: "Search collections",
        }}
        actions={
          <TenantFilter
            value={tenant}
            onChange={(t) => {
              setTenant(t)
              setOffset(0)
            }}
          />
        }
      />
      <QueryBoundary title="Collections" query={list} keepPreviousData>
        {(data) => (
          <ResourceTable<Collection>
            columns={columns}
            rows={data.items}
            rowKey={(c) => c.id}
            caption={plural(data.total, "collection", "collections")}
            emptyMessage={filtered ? "No collections match these filters." : "No collections yet. Create one to start ingesting."}
            pagination={pageOf(data)}
            onPageChange={(page) => setOffset(offsetFor(page, data.limit))}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

The search box resets paging at once, but the request only changes when the debounced term does. That is intended: the first page is what you want to see for a new search.

- [ ] **Step 4: Register the page**

In `src/index.tsx`, import `LibraryIcon` and `CollectionsPage`, export `CollectionsPage`, add `{ label: "Collections", to: "/collections", priority: 10, icon: <LibraryIcon />, group: "RAG" }` to `nav` and `{ path: "/collections", element: CollectionsPage }` to `routes`.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS. The paging test reads "Page 1 of 2, 30 total" from `ResourceTable`; if the kit words its pagination status differently, match the kit's text and say so.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/pages/collections.tsx packages/plugin-weave/test/collections.test.tsx
git commit --only -m "feat(plugin-weave): add the collections page" -m "<body>" -- packages/plugin-weave/src/pages/collections.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/collections.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

---

### Task 6: Create and edit a collection

**Files:**
- Create: `packages/plugin-weave/src/components/metadata-editor.tsx`, `src/pages/collection-create.tsx`, `src/pages/collection-edit.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/metadata-editor.test.tsx`, `test/collection-create.test.tsx`, `test/collection-edit.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `Collection`, `CollectionDetail`, `ComponentsOutput` (types); `collectionPath`; `formatCount` from Task 1.
- Produces: `MetadataRow`, `rowsOf(metadata)`, `metadataOf(rows): { metadata: Record<string, string> } | { error: string }`, `MetadataEditor({ rows, onChange })` from `src/components/metadata-editor.tsx` (Task 8 uses them); `CollectionCreatePage`, `CollectionEditPage`.

- [ ] **Step 1: Write the failing tests**

`test/metadata-editor.test.tsx`:

```tsx
import { useState } from "react"
import { describe, expect, it } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { MetadataEditor, metadataOf, rowsOf } from "../src/components/metadata-editor"
import type { MetadataRow } from "../src/components/metadata-editor"

describe("metadataOf", () => {
  it("builds a map, skipping fully blank rows", () => {
    expect(metadataOf([{ key: "team", value: "support" }, { key: "", value: "" }])).toEqual({ metadata: { team: "support" } })
  })

  it("trims keys and refuses a value with no key or a key given twice", () => {
    expect(metadataOf([{ key: " team ", value: "x" }])).toEqual({ metadata: { team: "x" } })
    expect(metadataOf([{ key: "", value: "x" }])).toEqual({ error: "Every value needs a key." })
    expect(metadataOf([{ key: "a", value: "1" }, { key: "a", value: "2" }])).toEqual({ error: 'The key "a" appears twice.' })
  })
})

describe("rowsOf", () => {
  it("sorts by key", () => {
    expect(rowsOf({ b: "2", a: "1" })).toEqual([{ key: "a", value: "1" }, { key: "b", value: "2" }])
  })
})

function Probe() {
  const [rows, setRows] = useState<MetadataRow[]>([])
  return (
    <div>
      <MetadataEditor rows={rows} onChange={setRows} />
      <output aria-label="result">{JSON.stringify(metadataOf(rows))}</output>
    </div>
  )
}

describe("MetadataEditor", () => {
  it("adds, edits and removes rows", () => {
    render(<Probe />)
    fireEvent.click(screen.getByRole("button", { name: "Add a field" }))
    fireEvent.change(screen.getByLabelText("Metadata key 1"), { target: { value: "team" } })
    fireEvent.change(screen.getByLabelText("Metadata value 1"), { target: { value: "support" } })
    expect(screen.getByLabelText("result").textContent).toBe('{"metadata":{"team":"support"}}')
    fireEvent.click(screen.getByRole("button", { name: "Remove metadata field 1" }))
    expect(screen.getByLabelText("result").textContent).toBe('{"metadata":{}}')
  })
})
```

`test/collection-create.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionCreatePage } from "../src/pages/collection-create"
import { renderWithNavigate, scriptedClient } from "./harness"

const COMPONENTS = {
  components: {
    loader: { kind: "text", configured: true },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", params: { model: "text-embedding-3-small" }, configured: true, dimensions: 1536 },
    vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever: { kind: "mmr", configured: true },
    score: "mmr_relevance",
    tenant_filter: "verified",
  },
  config: { default_chunk_size: 512, default_chunk_overlap: 50, default_embedding_model: "text-embedding-3-small", default_chunk_strategy: "recursive", default_top_k: 10, shutdown_timeout_seconds: 30 },
  extensions: [],
}

const CREATED = { id: "col_01k70000000000000000001000", name: "faq" }

function fill(name: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } })
}

describe("CollectionCreatePage", () => {
  it("sends the trimmed name and zeros for empty chunk settings, then opens the new collection", async () => {
    const { client, sent } = scriptedClient({ "system.components": COMPONENTS }, { "collections.create": CREATED })
    const { navigate } = renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Recorded, not used/)
    fill("  faq  ")
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/collections/col_01k70000000000000000001000"))
    expect(sent).toEqual([{ intent: "collections.create", payload: { name: "faq", description: "", chunk_size: 0, chunk_overlap: 0, metadata: {} } }])
  })

  it("shows the defaults it will use and says an overlap of 0 means the default", async () => {
    const { client } = scriptedClient({ "system.components": COMPONENTS }, {})
    renderWithNavigate(CollectionCreatePage, client)
    expect(await screen.findByText(/Leave it empty or 0 for the default \(50 tokens\)/)).toBeTruthy()
    expect((screen.getByLabelText("Chunk size") as HTMLInputElement).placeholder).toBe("512")
  })

  it("refuses an effective overlap at or above the effective size before sending", async () => {
    const { client, sent } = scriptedClient({ "system.components": COMPONENTS }, { "collections.create": CREATED })
    renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Recorded, not used/)
    fill("tiny")
    fireEvent.change(screen.getByLabelText("Chunk size"), { target: { value: "40" } })
    expect(screen.getByText("chunk overlap 50 (the default) must be smaller than chunk size 40")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Create collection" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("says what is recorded and what actually runs", async () => {
    const { client } = scriptedClient({ "system.components": COMPONENTS }, {})
    renderWithNavigate(CollectionCreatePage, client)
    const box = await screen.findByText(/Recorded, not used/)
    expect(box.closest("section")?.textContent).toMatch(/never reads them back/)
    expect(box.closest("section")?.textContent).toMatch(/openai/)
  })

  it("shows the server's refusal and stays on the form", async () => {
    const { client } = scriptedClient(
      { "system.components": COMPONENTS },
      { "collections.create": new ContractError("CONFLICT", "a collection with this name already exists") },
    )
    const { navigate } = renderWithNavigate(CollectionCreatePage, client)
    await screen.findByText(/Recorded, not used/)
    fill("support-articles")
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }))
    expect(await screen.findByText("a collection with this name already exists")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("support-articles")
  })
})
```

`test/collection-edit.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionEditPage } from "../src/pages/collection-edit"
import { renderWithNavigate, scriptedClient } from "./harness"

const ID = "col_01k70000000000000000000001"

const DETAIL = {
  created_at: "2026-09-07T09:00:00Z",
  updated_at: "2026-09-07T09:00:00Z",
  id: ID,
  name: "support-articles",
  description: "Help centre articles.",
  tenant_id: "",
  app_id: "",
  embedding_model: "text-embedding-3-small",
  embedding_dims: 1536,
  chunk_strategy: "recursive",
  chunk_size: 48,
  chunk_overlap: 8,
  metadata: { team: "support" },
  document_count: 5,
  chunk_count: 21,
  documents_by_state: { pending: 1, processing: 1, ready: 2, failed: 1 },
  stalled: 1,
}

describe("CollectionEditPage", () => {
  it("reads the collection it was opened for", async () => {
    const { client, queried } = scriptedClient({ "collections.get": DETAIL }, {})
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    expect(await screen.findByDisplayValue("support-articles")).toBeTruthy()
    expect(queried[0]).toEqual({ intent: "collections.get", params: { id: ID } })
  })

  it("sends only the fields that changed, then opens the collection", async () => {
    const { client, sent } = scriptedClient({ "collections.get": DETAIL }, { "collections.update": { ...DETAIL, name: "help-articles" } })
    const { navigate } = renderWithNavigate(CollectionEditPage, client, { id: ID })
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: " help-articles " } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/collections/${ID}`))
    expect(sent).toEqual([{ intent: "collections.update", payload: { id: ID, name: "help-articles" } }])
  })

  it("sends the whole metadata map when it changed, because it replaces rather than merges", async () => {
    const { client, sent } = scriptedClient({ "collections.get": DETAIL }, { "collections.update": DETAIL })
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    fireEvent.change(await screen.findByLabelText("Metadata value 1"), { target: { value: "help" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "collections.update", payload: { id: ID, metadata: { team: "help" } } }]))
  })

  it("waits for a change before it can save", async () => {
    const { client } = scriptedClient({ "collections.get": DETAIL }, {})
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    await screen.findByDisplayValue("support-articles")
    expect((screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows the chunk settings read-only and says why", async () => {
    const { client } = scriptedClient({ "collections.get": DETAIL }, {})
    renderWithNavigate(CollectionEditPage, client, { id: ID })
    expect(await screen.findByText(/Fixed at creation. Weave can't re-chunk existing documents/)).toBeTruthy()
    expect(screen.queryByLabelText("Chunk size")).toBeNull()
  })

  it("shows a refused rename and keeps the edit", async () => {
    const { client } = scriptedClient(
      { "collections.get": DETAIL },
      { "collections.update": new ContractError("CONFLICT", "a collection with this name already exists") },
    )
    const { navigate } = renderWithNavigate(CollectionEditPage, client, { id: ID })
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "acme-handbook" } })
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }))
    expect(await screen.findByText("a collection with this name already exists")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("routes the collection forms", () => {
    const paths = weavePlugin.routes.map((r) => r.path)
    expect(paths).toContain("/collections/new")
    expect(paths).toContain("/collections/:id/edit")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the metadata editor**

`src/components/metadata-editor.tsx`:

```tsx
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"

export interface MetadataRow {
  key: string
  value: string
}

export function rowsOf(metadata: Record<string, string> | undefined): MetadataRow[] {
  return Object.keys(metadata ?? {})
    .sort()
    .map((key) => ({ key, value: metadata![key] }))
}

/** The map the rows describe, or the reason they don't describe one. */
export function metadataOf(rows: MetadataRow[]): { metadata: Record<string, string> } | { error: string } {
  const metadata: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key === "" && row.value === "") continue
    if (key === "") return { error: "Every value needs a key." }
    if (key in metadata) return { error: `The key "${key}" appears twice.` }
    metadata[key] = row.value
  }
  return { metadata }
}

/** Key and value pairs. Weave stores metadata as strings. */
export function MetadataEditor({ rows, onChange }: { rows: MetadataRow[]; onChange: (rows: MetadataRow[]) => void }) {
  const set = (i: number, patch: Partial<MetadataRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input aria-label={`Metadata key ${i + 1}`} className="w-48 font-mono text-xs" spellCheck={false} value={row.key} onChange={(e) => set(i, { key: e.target.value })} />
          <Input aria-label={`Metadata value ${i + 1}`} className="flex-1" value={row.value} onChange={(e) => set(i, { value: e.target.value })} />
          <Button type="button" variant="ghost" size="sm" aria-label={`Remove metadata field ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, { key: "", value: "" }])}>
          Add a field
        </Button>
      </div>
    </div>
  )
}
```

If the kit's `Button` has no `sm` size, use the closest one it has.

- [ ] **Step 4: Write the create page**

`src/pages/collection-create.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { MetadataEditor, metadataOf } from "../components/metadata-editor"
import type { MetadataRow } from "../components/metadata-editor"
import { collectionPath } from "../links"
import type { Collection, ComponentsOutput, EngineConfig } from "../types"

/** "" is 0 (the default). Anything but a whole number is NaN. */
function parseTokens(raw: string): number {
  const t = raw.trim()
  if (t === "") return 0
  return /^\d+$/.test(t) ? Number(t) : Number.NaN
}

/**
 * The overlap rule as the server applies it: 0 means the default, and the
 * effective overlap must be smaller than the effective size. The message is
 * the server's, so the form and a refusal read the same.
 */
export function overlapProblem(size: number, overlap: number, config: EngineConfig | undefined): string | null {
  if (!config || Number.isNaN(size) || Number.isNaN(overlap)) return null
  const effSize = size === 0 ? config.default_chunk_size : size
  const effOverlap = overlap === 0 ? config.default_chunk_overlap : overlap
  if (effOverlap < effSize) return null
  const from = (given: number) => (given === 0 ? " (the default)" : "")
  return `chunk overlap ${effOverlap}${from(overlap)} must be smaller than chunk size ${effSize}${from(size)}`
}

export const CollectionCreatePage: ComponentType<PluginPageProps> = () => {
  const report = useQuery<ComponentsOutput>("system.components", {})
  const create = useCommand<Collection>("collections.create")
  const navigateTo = useNavigateTo()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [size, setSize] = useState("")
  const [overlap, setOverlap] = useState("")
  const [rows, setRows] = useState<MetadataRow[]>([])

  const config = report.data?.config
  const sizeN = parseTokens(size)
  const overlapN = parseTokens(overlap)
  const problem = overlapProblem(sizeN, overlapN, config)
  const meta = metadataOf(rows)
  const canSubmit =
    !create.loading && name.trim() !== "" && !Number.isNaN(sizeN) && !Number.isNaN(overlapN) && problem === null && "metadata" in meta

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || !("metadata" in meta)) return
    const result = await create.execute({
      name: name.trim(),
      description,
      chunk_size: sizeN,
      chunk_overlap: overlapN,
      metadata: meta.metadata,
    })
    if (result === undefined) return
    navigateTo(collectionPath(result.id))
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="New collection" description="A collection groups documents that are chunked and embedded the same way." />
      <CommandAlert title="Could not create the collection" error={create.error} />
      <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="collection-name">Name</Label>
          <Input id="collection-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          <p className="text-xs text-muted-foreground">Unique within its tenant. The dashboard creates collections with no tenant.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="collection-description">Description</Label>
          <Textarea id="collection-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="collection-size">Chunk size</Label>
            <Input
              id="collection-size"
              inputMode="numeric"
              className="font-mono"
              placeholder={config ? String(config.default_chunk_size) : ""}
              value={size}
              aria-invalid={Number.isNaN(sizeN) || undefined}
              onChange={(e) => setSize(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              In tokens (characters ÷ 4). {config ? `Leave it empty for the default (${config.default_chunk_size} tokens).` : null}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="collection-overlap">Chunk overlap</Label>
            <Input
              id="collection-overlap"
              inputMode="numeric"
              className="font-mono"
              placeholder={config ? String(config.default_chunk_overlap) : ""}
              value={overlap}
              aria-invalid={Number.isNaN(overlapN) || problem !== null || undefined}
              onChange={(e) => setOverlap(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {config ? `Leave it empty or 0 for the default (${config.default_chunk_overlap} tokens). ` : null}
              Weave reads 0 as the default, so a collection can't be created with no overlap.
            </p>
          </div>
        </div>
        {Number.isNaN(sizeN) || Number.isNaN(overlapN) ? (
          <p role="alert" className="text-sm text-destructive">Use a whole number of tokens.</p>
        ) : null}
        {problem ? (
          <p role="alert" className="text-sm text-destructive">{problem}</p>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Metadata</span>
          <MetadataEditor rows={rows} onChange={setRows} />
          {"error" in meta ? <p role="alert" className="text-sm text-destructive">{meta.error}</p> : null}
        </div>
        <section className="flex flex-col gap-1 rounded-md border p-3 text-sm">
          <h2 className="font-medium">Recorded, not used</h2>
          <QueryBoundary title="What this deployment runs" query={report} skeletonRows={2}>
            {(data) => (
              <p className="text-muted-foreground">
                A new collection records the model <span className="font-mono text-xs">{data.config.default_embedding_model}</span>,{" "}
                {data.components.embedder.dimensions ?? 0} dimensions and the strategy{" "}
                <span className="font-mono text-xs">{data.config.default_chunk_strategy}</span>. Weave never reads them back: this deployment embeds with{" "}
                <span className="font-mono text-xs">{data.components.embedder.kind || "no embedder"}</span> and chunks with{" "}
                <span className="font-mono text-xs">{data.components.chunker.kind || "no chunker"}</span> for every collection.
              </p>
            )}
          </QueryBoundary>
        </section>
        <div className="flex gap-2">
          <Button type="submit" disabled={!canSubmit}>
            {create.loading ? "Creating…" : "Create collection"}
          </Button>
          <PluginLink to="/collections" className="self-center text-sm underline">
            Cancel
          </PluginLink>
        </div>
      </form>
    </section>
  )
}
```

The overlap check needs the engine's defaults, so the button also waits for `system.components`: `problem` is null until `config` arrives, and that is fine, because the server applies the same rule and its message is identical. If `report` fails, the box shows its error card and the form still submits.

- [ ] **Step 5: Write the edit page**

`src/pages/collection-edit.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { MetadataEditor, metadataOf, rowsOf } from "../components/metadata-editor"
import type { MetadataRow } from "../components/metadata-editor"
import { formatCount } from "../format"
import { collectionPath } from "../links"
import type { Collection, CollectionDetail } from "../types"

const FIXED =
  "Fixed at creation. Weave can't re-chunk existing documents, so a change would only apply to new ones. Reindex re-embeds the existing chunks with the current embedder; it doesn't re-chunk."

function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k])
}

function EditForm({ collection }: { collection: CollectionDetail }) {
  const update = useCommand<Collection>("collections.update")
  const navigateTo = useNavigateTo()
  const [name, setName] = useState(collection.name)
  const [description, setDescription] = useState(collection.description ?? "")
  const [rows, setRows] = useState<MetadataRow[]>(rowsOf(collection.metadata))

  const meta = metadataOf(rows)
  // Only what changed goes out: every field but id is a pointer on the Go
  // side, and an absent one is left alone. Metadata replaces the whole map.
  const payload: Record<string, unknown> = { id: collection.id }
  if (name.trim() !== collection.name) payload.name = name.trim()
  if (description !== (collection.description ?? "")) payload.description = description
  if ("metadata" in meta && !sameMap(meta.metadata, collection.metadata)) payload.metadata = meta.metadata
  const changed = Object.keys(payload).length > 1
  const canSubmit = !update.loading && changed && name.trim() !== "" && "metadata" in meta

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const result = await update.execute(payload)
    if (result === undefined) return
    navigateTo(collectionPath(collection.id))
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex max-w-2xl flex-col gap-4">
      <CommandAlert title="Could not save the collection" error={update.error} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="collection-name">Name</Label>
        <Input id="collection-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="collection-description">Description</Label>
        <Textarea id="collection-description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Metadata</span>
        <MetadataEditor rows={rows} onChange={setRows} />
        {"error" in meta ? <p role="alert" className="text-sm text-destructive">{meta.error}</p> : null}
      </div>
      <section className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <h2 className="font-medium">Chunk settings</h2>
        <DescriptionList
          items={[
            { term: "Chunk size", value: <span className="font-mono text-xs">{formatCount(collection.chunk_size)} tokens</span> },
            { term: "Chunk overlap", value: <span className="font-mono text-xs">{formatCount(collection.chunk_overlap)} tokens</span> },
          ]}
        />
        <p className="text-muted-foreground">{FIXED}</p>
      </section>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {update.loading ? "Saving…" : "Save changes"}
        </Button>
        <PluginLink to={collectionPath(collection.id)} className="text-sm underline">
          Cancel
        </PluginLink>
        {!changed ? <span className="text-sm text-muted-foreground">Nothing to save yet.</span> : null}
      </div>
    </form>
  )
}

export const CollectionEditPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const detail = useQuery<CollectionDetail>("collections.get", { id })
  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Edit collection" description="Name, description and metadata. Chunk settings are fixed when a collection is made." />
      <QueryBoundary title="Collection" query={detail} skeletonRows={4}>
        {(data) => <EditForm key={data.id} collection={data} />}
      </QueryBoundary>
    </section>
  )
}
```

The form seeds its state from the collection once, through `key`, rather than copying query data into state from an effect.

- [ ] **Step 6: Register the pages**

In `src/index.tsx`, import and export `CollectionCreatePage` and `CollectionEditPage`, and add `{ path: "/collections/new", element: CollectionCreatePage }` and `{ path: "/collections/:id/edit", element: CollectionEditPage }` to `routes`. No nav entries.

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/components/metadata-editor.tsx packages/plugin-weave/src/pages/collection-create.tsx packages/plugin-weave/src/pages/collection-edit.tsx packages/plugin-weave/test/metadata-editor.test.tsx packages/plugin-weave/test/collection-create.test.tsx packages/plugin-weave/test/collection-edit.test.tsx
git commit --only -m "feat(plugin-weave): create and edit collections" -m "<body>" -- packages/plugin-weave/src/components/metadata-editor.tsx packages/plugin-weave/src/pages/collection-create.tsx packages/plugin-weave/src/pages/collection-edit.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/metadata-editor.test.tsx packages/plugin-weave/test/collection-create.test.tsx packages/plugin-weave/test/collection-edit.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: the create form checks overlap against size the way the server does and says an overlap of 0 means the default, and the edit form sends only what changed, because a missing field on the Go side is left alone.

---

### Task 7: Collection detail, reindex and delete

**Files:**
- Create: `packages/plugin-weave/src/pages/collection-detail.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/collection-detail.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `CollectionDetail`, `DocumentRow`, `ListOutput`, `ReindexOutput`, `IdOutput` (types); `documentColumns` (Task 3); `MetadataList`, `Id`, `collectionEditPath`, `collectionIngestPath`, `documentsHref`, `chunksHref`, `formatCount`, `formatMs`, `plural` (Task 1).
- Produces: `CollectionDetailPage`.

- [ ] **Step 1: Write the failing tests**

`test/collection-detail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { CollectionDetailPage } from "../src/pages/collection-detail"
import { renderWithNavigate, scriptedClient } from "./harness"

const ID = "col_01k70000000000000000000001"

const DETAIL = {
  created_at: "2026-09-07T09:00:00Z",
  updated_at: "2026-09-08T09:00:00Z",
  id: ID,
  name: "support-articles",
  description: "Help centre articles.",
  tenant_id: "",
  app_id: "",
  embedding_model: "text-embedding-3-small",
  embedding_dims: 1536,
  chunk_strategy: "recursive",
  chunk_size: 48,
  chunk_overlap: 8,
  metadata: { team: "support" },
  document_count: 5,
  chunk_count: 21,
  documents_by_state: { pending: 1, processing: 1, ready: 2, failed: 1 },
  stalled: 1,
}

const DOCS = {
  items: [
    {
      created_at: "2026-10-07T09:00:00Z", updated_at: "2026-10-07T09:00:00Z",
      id: "doc_01k70000000000000000000001", collection_id: ID, tenant_id: "",
      title: "Refund policy", content_hash: "ab".repeat(32), content_length: 812, chunk_count: 6,
      metadata: {}, state: "ready", collection_name: "support-articles", stalled: false,
    },
  ],
  total: 5,
  limit: 10,
  offset: 0,
}

function queries(over: Record<string, unknown> = {}) {
  return { "collections.get": DETAIL, "documents.list": DOCS, ...over }
}

async function openDialog(button: string) {
  fireEvent.click(await screen.findByRole("button", { name: button }))
  return screen.findByRole("alertdialog")
}

describe("CollectionDetailPage", () => {
  it("reads the collection and its ten newest documents", async () => {
    const { client, queried } = scriptedClient(queries())
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await screen.findByRole("heading", { name: "support-articles" })
    expect(queried).toContainEqual({ intent: "collections.get", params: { id: ID } })
    expect(queried).toContainEqual({ intent: "documents.list", params: { collection_id: ID, limit: 10 } })
  })

  it("shows its stats, its identity and what it recorded but does not use", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await screen.findByRole("heading", { name: "support-articles" })
    expect(screen.getByText("Looks stalled")).toBeTruthy()
    expect(screen.getByText(ID).className).toContain("font-mono")
    expect(screen.getByLabelText("no tenant")).toBeTruthy()
    expect(screen.getByText(/Recorded when the collection was made and never used/)).toBeTruthy()
    expect(screen.getByText("team")).toBeTruthy()
    expect(screen.getByText("1 newest of 5 documents")).toBeTruthy()
  })

  it("links to ingest, edit, and the full document and chunk lists", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    await screen.findByRole("heading", { name: "support-articles" })
    expect(screen.getByRole("link", { name: "Ingest" }).getAttribute("href")).toBe(`/collections/${ID}/ingest`)
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(`/collections/${ID}/edit`)
    expect(screen.getByRole("link", { name: "All documents in this collection" }).getAttribute("href")).toBe(`/@weave/documents?collection_id=${ID}`)
    expect(screen.getByRole("link", { name: "Its chunks" }).getAttribute("href")).toBe(`/@weave/chunks?collection_id=${ID}`)
  })

  it("says what reindex does before it runs, then reports what it did", async () => {
    const { client, sent } = scriptedClient(queries(), { "collections.reindex": { id: ID, reindexed_documents: 2, elapsed_ms: 812.5 } })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Reindex")
    expect(within(dialog).getByText(/deletes every vector in this collection first/)).toBeTruthy()
    expect(within(dialog).getByText(/leaves the collection partly indexed/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    expect(await screen.findByText("Re-embedded 2 documents in 813 ms.")).toBeTruthy()
    expect(sent).toEqual([{ intent: "collections.reindex", payload: { id: ID } }])
  })

  it("keeps a failed reindex inside the dialog and says the collection may be partly indexed", async () => {
    const { client } = scriptedClient(queries(), { "collections.reindex": new ContractError("INTERNAL", "an internal error occurred") })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Reindex")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    expect(await within(dialog).findByText("an internal error occurred")).toBeTruthy()
    expect(within(dialog).getByText(/may now be partly indexed/)).toBeTruthy()
    expect(within(dialog).getByRole("button", { name: "Run reindex again" })).toBeTruthy()
  })

  it("does not call a missing embedder a partial reindex", async () => {
    const { client } = scriptedClient(queries(), {
      "collections.reindex": new ContractError("UNAVAILABLE", "Weave has no embedder configured, so it cannot ingest or search"),
    })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Reindex")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    expect(await within(dialog).findByText(/no embedder configured/)).toBeTruthy()
    expect(within(dialog).queryByText(/partly indexed/)).toBeNull()
  })

  it("clears an earlier failure when the dialog opens again", async () => {
    const { client } = scriptedClient(queries(), { "collections.reindex": new ContractError("INTERNAL", "an internal error occurred") })
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    let dialog = await openDialog("Reindex")
    fireEvent.click(within(dialog).getByRole("button", { name: "Reindex" }))
    await within(dialog).findByText("an internal error occurred")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    dialog = await openDialog("Reindex")
    expect(within(dialog).queryByText("an internal error occurred")).toBeNull()
  })

  it("deletes after confirming what goes with it, then leaves for the list", async () => {
    const { client, sent } = scriptedClient(queries(), { "collections.delete": { id: ID } })
    const { navigate } = renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Delete")
    expect(within(dialog).getByText(/5 documents and 21 chunks, and their vectors/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete collection" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/collections", { replace: true }))
    expect(sent).toEqual([{ intent: "collections.delete", payload: { id: ID } }])
  })

  it("keeps a failed delete inside the dialog", async () => {
    const { client } = scriptedClient(queries(), { "collections.delete": new ContractError("NOT_FOUND", "collection not found") })
    const { navigate } = renderWithNavigate(CollectionDetailPage, client, { id: ID })
    const dialog = await openDialog("Delete")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete collection" }))
    expect(await within(dialog).findByText("collection not found")).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  it("shows an error card for a collection that doesn't exist", async () => {
    const { client } = scriptedClient(queries({ "collections.get": new ContractError("NOT_FOUND", "collection not found") }))
    renderWithNavigate(CollectionDetailPage, client, { id: ID })
    expect(await screen.findByText(/collection not found/)).toBeTruthy()
  })
})
```

`ConfirmDialog` is built on the kit's `AlertDialog`, so its role is `alertdialog`. Check `packages/kit/src/components/alert-dialog.tsx`; if it renders `role="dialog"`, use that role in these tests.

Append to `test/plugin.test.tsx`:

```tsx
  it("routes a collection's own page", () => {
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/collections/:id")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the page**

`src/pages/collection-detail.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { ContractError, PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription } from "@forge-go/dashboard-kit/components/alert"
import { Button, buttonVariants } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { StatGrid } from "@forge-go/dashboard-kit/components/stat-grid"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { documentColumns } from "../components/document-columns"
import { Id } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { formatCount, formatMs, plural } from "../format"
import { chunksHref, collectionEditPath, collectionIngestPath, documentsHref } from "../links"
import type { CollectionDetail, DocumentRow, IdOutput, ListOutput, ReindexOutput } from "../types"

const columns = documentColumns({ withCollection: false })

const REINDEX =
  "Reindex deletes every vector in this collection first, then re-embeds the chunks of its ready documents with the current embedder. It never re-chunks. It runs inside this request, and a failure partway leaves the collection partly indexed."

/**
 * A reindex that failed after it started has already deleted vectors. A
 * missing stage is refused before anything is touched, so it says nothing
 * about the collection's state.
 */
function mayBePartial(error: ContractError | undefined): boolean {
  if (!error) return false
  if (error.code === "INTERNAL") return true
  return error.code === "UNAVAILABLE" && !/configured/.test(error.message)
}

export const CollectionDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const detail = useQuery<CollectionDetail>("collections.get", { id })
  const docs = useQuery<ListOutput<DocumentRow>>("documents.list", { collection_id: id, limit: 10 })
  const reindex = useCommand<ReindexOutput>("collections.reindex")
  const remove = useCommand<IdOutput>("collections.delete")
  const navigateTo = useNavigateTo()
  const [dialog, setDialog] = useState<"reindex" | "delete" | null>(null)
  const [reindexed, setReindexed] = useState<ReindexOutput | null>(null)

  function open(kind: "reindex" | "delete") {
    // One hook per command, pointed at this collection: a failure from the
    // last attempt must not greet the next one.
    if (kind === "reindex") reindex.reset()
    else remove.reset()
    setDialog(kind)
  }

  function onOpenChange(next: boolean, pending: boolean) {
    if (!next && pending) return
    if (!next) setDialog(null)
  }

  async function runReindex() {
    const result = await reindex.execute({ id })
    if (result === undefined) return
    setReindexed(result)
    setDialog(null)
  }

  async function runDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    navigateTo("/collections", { replace: true })
  }

  return (
    <QueryBoundary title="Collection" query={detail} skeletonRows={8}>
      {(c) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={c.name}
            description={c.description}
            actions={
              <div className="flex gap-2">
                <PluginLink to={collectionIngestPath(c.id)} className={buttonVariants()}>
                  Ingest
                </PluginLink>
                <PluginLink to={collectionEditPath(c.id)} className={buttonVariants({ variant: "outline" })}>
                  Edit
                </PluginLink>
                <Button variant="outline" onClick={() => open("reindex")}>
                  Reindex
                </Button>
                <Button variant="destructive" onClick={() => open("delete")}>
                  Delete
                </Button>
              </div>
            }
          />

          {reindexed ? (
            <Alert>
              <AlertDescription>
                Re-embedded {plural(reindexed.reindexed_documents, "document", "documents")} in {formatMs(reindexed.elapsed_ms)}.
              </AlertDescription>
            </Alert>
          ) : null}

          <StatGrid
            items={[
              { label: "Documents", value: formatCount(c.document_count) },
              { label: "Chunks", value: formatCount(c.chunk_count) },
              { label: "Ready", value: formatCount(c.documents_by_state.ready) },
              { label: "Pending", value: formatCount(c.documents_by_state.pending) },
              { label: "Processing", value: formatCount(c.documents_by_state.processing) },
              { label: "Failed", value: formatCount(c.documents_by_state.failed), tone: c.documents_by_state.failed > 0 ? "danger" : "default" },
              { label: "Looks stalled", value: formatCount(c.stalled), tone: c.stalled > 0 ? "warning" : "default" },
            ]}
          />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Details</h2>
            <DescriptionList
              items={[
                { term: "ID", value: <Id value={c.id} /> },
                { term: "Tenant", value: c.tenant_id !== "" ? <Id value={c.tenant_id} /> : <NoneCell label="tenant" /> },
                { term: "App", value: c.app_id !== "" ? <Id value={c.app_id} /> : <NoneCell label="app" /> },
                { term: "Created", value: <Timestamp value={c.created_at} label="creation date" /> },
                { term: "Updated", value: <Timestamp value={c.updated_at} label="update" /> },
                { term: "Chunk size", value: <span className="font-mono text-xs">{formatCount(c.chunk_size)} tokens</span> },
                { term: "Chunk overlap", value: <span className="font-mono text-xs">{formatCount(c.chunk_overlap)} tokens</span> },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2 rounded-md border p-3">
            <h2 className="text-sm font-medium">Embedding model, dimensions and strategy</h2>
            <p className="text-sm text-muted-foreground">Recorded when the collection was made and never used: one embedder and one chunker serve every collection.</p>
            <DescriptionList
              items={[
                { term: "Model", value: <span className="font-mono text-xs">{c.embedding_model || "none"}</span> },
                { term: "Dimensions", value: <span className="font-mono text-xs">{c.embedding_dims}</span> },
                { term: "Strategy", value: <span className="font-mono text-xs">{c.chunk_strategy || "none"}</span> },
              ]}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Metadata</h2>
            <MetadataList metadata={c.metadata} />
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium">Newest documents</h2>
              <div className="flex gap-4 text-sm">
                <PluginLink to={documentsHref({ collection_id: c.id })} className="underline-offset-4 hover:underline">
                  All documents in this collection
                </PluginLink>
                <PluginLink to={chunksHref(c.id)} className="underline-offset-4 hover:underline">
                  Its chunks
                </PluginLink>
              </div>
            </div>
            <QueryBoundary title="Documents" query={docs} skeletonRows={3}>
              {(list) => (
                <ResourceTable<DocumentRow>
                  columns={columns}
                  rows={list.items}
                  rowKey={(d) => d.id}
                  caption={`${formatCount(list.items.length)} newest of ${plural(list.total, "document", "documents")}`}
                  emptyMessage="No documents yet. Ingest one to see it here."
                />
              )}
            </QueryBoundary>
          </section>

          <ConfirmDialog
            open={dialog === "reindex"}
            onOpenChange={(next) => onOpenChange(next, reindex.loading)}
            title={`Reindex ${c.name}?`}
            description={REINDEX}
            confirmLabel={mayBePartial(reindex.error) ? "Run reindex again" : "Reindex"}
            pending={reindex.loading}
            onConfirm={() => void runReindex()}
          >
            <CommandAlert title="The reindex did not finish" error={reindex.error} />
            {mayBePartial(reindex.error) ? (
              <p className="text-sm">
                If it had started, this collection may now be partly indexed: some documents have their vectors back and the rest have none, so
                searches will miss the rest until a reindex finishes.
              </p>
            ) : null}
          </ConfirmDialog>

          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(next) => onOpenChange(next, remove.loading)}
            title={`Delete ${c.name}?`}
            description={`This deletes the collection with its ${plural(c.document_count, "document", "documents")} and ${plural(c.chunk_count, "chunk", "chunks")}, and their vectors. You can't undo it.`}
            confirmLabel="Delete collection"
            pending={remove.loading}
            onConfirm={() => void runDelete()}
          >
            <CommandAlert title="Could not delete the collection" error={remove.error} />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}
```

The confirm button's label swaps while `pending`, so the test clicks it by its idle label before the command settles. If `CommandAlert` puts the message inside a longer string, keep the `findByText` matchers as regexes.

- [ ] **Step 4: Register the page**

In `src/index.tsx`, import and export `CollectionDetailPage` and add `{ path: "/collections/:id", element: CollectionDetailPage }` to `routes`.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/pages/collection-detail.tsx packages/plugin-weave/test/collection-detail.test.tsx
git commit --only -m "feat(plugin-weave): add a collection's own page with reindex and delete" -m "<body>" -- packages/plugin-weave/src/pages/collection-detail.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/collection-detail.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: the reindex dialog says it deletes every vector first and re-embeds without re-chunking, and when it fails after starting it tells you the collection may be partly indexed and offers to run it again.

---
### Task 8: Ingest

**Files:**
- Create: `packages/plugin-weave/src/ingest.ts`, `src/pages/ingest.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/ingest-limits.test.ts`, `test/ingest.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `CollectionDetail`, `ComponentsOutput`, `IngestOutput` (types); `MetadataEditor`, `metadataOf` (Task 6); `documentPath`, `documentsHref`, `collectionPath`, `formatBytes`, `utf8Length`, `plural` (Task 1).
- Produces: `CONTENT_CAP`, `ENVELOPE_CAP`, `sourceTypeFor(fileName)`, `requestBytes(payload)`, `sizeProblem(content, payload)`, `readText(file)` from `src/ingest.ts`; `IngestPage`.

- [ ] **Step 1: Write the failing tests**

`test/ingest-limits.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { CONTENT_CAP, requestBytes, sizeProblem, sourceTypeFor } from "../src/ingest"

describe("sourceTypeFor", () => {
  it("follows the file's extension", () => {
    expect(sourceTypeFor("notes.md")).toBe("text/markdown")
    expect(sourceTypeFor("FAQ.HTML")).toBe("text/html")
    expect(sourceTypeFor("rows.csv")).toBe("text/csv")
    expect(sourceTypeFor("data.json")).toBe("application/json")
    expect(sourceTypeFor("readme.txt")).toBe("text/plain")
    expect(sourceTypeFor("archive")).toBe("text/plain")
  })
})

describe("requestBytes", () => {
  it("counts the payload as the transport will see it, escaping included", () => {
    const plain = requestBytes({ content: "abc" })
    const escaped = requestBytes({ content: "a\nb" })
    expect(escaped - plain).toBe(1)
  })
})

describe("sizeProblem", () => {
  it("names Weave's own cap past 1 MiB of content", () => {
    const content = "a".repeat(CONTENT_CAP + 1)
    expect(sizeProblem(content, { content })).toMatch(/Weave ingests up to 1 MiB of text/)
  })

  it("refuses content whose encoded request is over the transport limit", () => {
    const content = "a\n".repeat(400_000)
    expect(content.length).toBeLessThan(CONTENT_CAP)
    expect(sizeProblem(content, { content })).toMatch(/contract_max_body_bytes/)
  })

  it("accepts a normal document", () => {
    expect(sizeProblem("Refunds take 14 days.", { content: "Refunds take 14 days." })).toBeNull()
  })
})
```

`test/ingest.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { IngestPage } from "../src/pages/ingest"
import { renderPage, scriptedClient } from "./harness"

const ID = "col_01k70000000000000000000001"
const DOC = "doc_01k70000000000000000001001"

const DETAIL = {
  created_at: "2026-09-07T09:00:00Z", updated_at: "2026-09-07T09:00:00Z", id: ID, name: "support-articles",
  tenant_id: "", app_id: "", embedding_model: "text-embedding-3-small", embedding_dims: 1536, chunk_strategy: "recursive",
  chunk_size: 48, chunk_overlap: 8, metadata: {}, document_count: 5, chunk_count: 21,
  documents_by_state: { pending: 0, processing: 0, ready: 5, failed: 0 }, stalled: 0,
}

const COMPONENTS = {
  components: {
    loader: { kind: "text", configured: true, content_types: ["text/plain", "text/markdown", "text/html"] },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true, dimensions: 1536 },
    vector_store: { kind: "memory", configured: true },
    retriever: { kind: "mmr", configured: true },
    score: "mmr_relevance",
    tenant_filter: "verified",
  },
  config: { default_chunk_size: 512, default_chunk_overlap: 50, default_embedding_model: "m", default_chunk_strategy: "recursive", default_top_k: 10, shutdown_timeout_seconds: 30 },
  extensions: [],
}

function queries() {
  return { "collections.get": DETAIL, "system.components": COMPONENTS }
}

async function paste(text: string) {
  fireEvent.change(await screen.findByLabelText("Content"), { target: { value: text } })
}

describe("IngestPage", () => {
  it("names the collection and the content types the loader reads", async () => {
    const { client, queried } = scriptedClient(queries(), {})
    renderPage(IngestPage, client, { id: ID })
    expect(await screen.findByText(/into support-articles/)).toBeTruthy()
    expect(queried).toContainEqual({ intent: "collections.get", params: { id: ID } })
    // Once in the content type picker and once in the list of what the loader reads.
    expect(screen.getAllByText("text/markdown").length).toBe(2)
  })

  it("sends pasted text with its title, source, type and metadata", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 3 } })
    renderPage(IngestPage, client, { id: ID })
    await paste("Refunds take 14 days.")
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Refunds" } })
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText("Ready: 3 chunks.")).toBeTruthy()
    expect(sent).toEqual([
      { intent: "documents.ingest", payload: { collection_id: ID, title: "Refunds", source: "", source_type: "text/plain", content: "Refunds take 14 days.", metadata: {} } },
    ])
    expect(screen.getByRole("link", { name: "Open the document" }).getAttribute("href")).toBe(`/documents/${DOC}`)
  })

  it("reads a picked file as text and takes its type from the name", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 1 } })
    renderPage(IngestPage, client, { id: ID })
    const file = new File(["# Shipping\nThree to five days."], "shipping.md", { type: "text/markdown" })
    fireEvent.change(await screen.findByLabelText("Pick a text file"), { target: { files: [file] } })
    await waitFor(() => expect((screen.getByLabelText("Content") as HTMLTextAreaElement).value).toBe("# Shipping\nThree to five days."))
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("shipping.md")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect((sent[0].payload as Record<string, unknown>).source_type).toBe("text/markdown")
    expect((sent[0].payload as Record<string, unknown>).source).toBe("shipping.md")
  })

  it("shows a failed ingest as an answer, with the stored error and a link", async () => {
    const { client } = scriptedClient(queries(), {
      "documents.ingest": { document_id: DOC, state: "failed", chunk_count: 0, error: "embed: provider answered 503 Service Unavailable" },
    })
    renderPage(IngestPage, client, { id: ID })
    await paste("Some text.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText(/provider answered 503/)).toBeTruthy()
    expect(screen.getByText("Ingest failed")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Open the document" }).getAttribute("href")).toBe(`/documents/${DOC}`)
  })

  it("explains a duplicate and links to the copies you might delete", async () => {
    const message = "this collection already has a document with exactly the same content (including a failed or stalled one; delete it to ingest again)"
    const { client } = scriptedClient(queries(), { "documents.ingest": new ContractError("CONFLICT", message) })
    renderPage(IngestPage, client, { id: ID })
    await paste("Refunds take 14 days.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Failed documents in this collection" }).getAttribute("href")).toBe(`/@weave/documents?collection_id=${ID}&state=failed`)
    expect(screen.getByRole("link", { name: "Processing documents in this collection" }).getAttribute("href")).toBe(`/@weave/documents?collection_id=${ID}&state=processing`)
  })

  it("refuses content whose encoded request is over the transport limit, before sending", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.ingest": { document_id: DOC, state: "ready", chunk_count: 1 } })
    renderPage(IngestPage, client, { id: ID })
    await paste("a\n".repeat(400_000))
    expect(screen.getByText(/contract_max_body_bytes/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Ingest" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("waits for content before it can ingest", async () => {
    const { client } = scriptedClient(queries(), {})
    renderPage(IngestPage, client, { id: ID })
    await screen.findByText(/into support-articles/)
    expect((screen.getByRole("button", { name: "Ingest" }) as HTMLButtonElement).disabled).toBe(true)
    await paste("   ")
    expect((screen.getByRole("button", { name: "Ingest" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("shows a missing embedder as the server says it", async () => {
    const { client } = scriptedClient(queries(), {
      "documents.ingest": new ContractError("UNAVAILABLE", "Weave has no embedder configured, so it cannot ingest or search"),
    })
    renderPage(IngestPage, client, { id: ID })
    await paste("Text.")
    fireEvent.click(screen.getByRole("button", { name: "Ingest" }))
    expect(await screen.findByText(/no embedder configured/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("routes ingest under its collection", () => {
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/collections/:id/ingest")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/ingest.ts`**

```ts
import { formatBytes, utf8Length } from "./format"

/** Weave's own cap on ingest content, in bytes. */
export const CONTENT_CAP = 1024 * 1024
/** Forge's default cap on a whole request envelope, in bytes. */
export const ENVELOPE_CAP = 1024 * 1024

const TYPES: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  csv: "text/csv",
  json: "application/json",
}

/** The source type Weave's loader is chosen by, from a file's extension. */
export function sourceTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : ""
  return TYPES[ext] ?? "text/plain"
}

/**
 * The size of the envelope the transport will refuse past 1 MiB, close
 * enough to decide on: the same fields the client sends, a 64 character CSRF
 * token and a UUID idempotency key. JSON escaping is what makes this larger
 * than the content: each quote, backslash and newline takes two bytes.
 */
export function requestBytes(payload: unknown): number {
  return utf8Length(
    JSON.stringify({
      envelope: "v1",
      kind: "command",
      contributor: "weave",
      intent: "documents.ingest",
      payload,
      csrf: "x".repeat(64),
      idempotencyKey: "00000000-0000-0000-0000-000000000000",
    }),
  )
}

/** Why this content can't be sent, naming the limit it hit, or null. */
export function sizeProblem(content: string, payload: unknown): string | null {
  const size = utf8Length(content)
  if (size > CONTENT_CAP) {
    return `Weave ingests up to 1 MiB of text (${formatBytes(CONTENT_CAP)}). This is ${formatBytes(size)}.`
  }
  const request = requestBytes(payload)
  if (request > ENVELOPE_CAP) {
    return `This is under Weave's 1 MiB cap, but the request would be ${formatBytes(request)} once JSON-encoded, which is over the dashboard's 1 MiB request limit. Your operator can raise contract_max_body_bytes in the dashboard's config; about 3 MiB covers files near Weave's cap.`
  }
  return null
}

/** A picked file's text. Blob.text where the browser has it, FileReader where it doesn't. */
export function readText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file)
  })
}
```

- [ ] **Step 4: Write the page**

`src/pages/ingest.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { PluginLink, useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Textarea } from "@forge-go/dashboard-kit/components/textarea"
import { MetadataEditor, metadataOf } from "../components/metadata-editor"
import type { MetadataRow } from "../components/metadata-editor"
import { formatBytes, plural, utf8Length } from "../format"
import { readText, sizeProblem, sourceTypeFor } from "../ingest"
import { collectionPath, documentPath, documentsHref } from "../links"
import type { CollectionDetail, ComponentsOutput, IngestOutput } from "../types"

const FALLBACK_TYPES = ["text/plain", "text/markdown", "text/html", "text/csv", "application/json"]

export const IngestPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const collection = useQuery<CollectionDetail>("collections.get", { id })
  const report = useQuery<ComponentsOutput>("system.components", {})
  const ingest = useCommand<IngestOutput>("documents.ingest")
  const [title, setTitle] = useState("")
  const [source, setSource] = useState("")
  const [sourceType, setSourceType] = useState("text/plain")
  const [content, setContent] = useState("")
  const [rows, setRows] = useState<MetadataRow[]>([])
  const [result, setResult] = useState<IngestOutput | null>(null)

  const supported = report.data?.components.loader.content_types ?? []
  const types = Array.from(new Set([...(supported.length > 0 ? supported : FALLBACK_TYPES), sourceType]))
  const meta = metadataOf(rows)
  const payload = {
    collection_id: id,
    title,
    source,
    source_type: sourceType,
    content,
    metadata: "metadata" in meta ? meta.metadata : {},
  }
  const problem = content === "" ? null : sizeProblem(content, payload)
  const canSubmit = !ingest.loading && content.trim() !== "" && problem === null && "metadata" in meta

  async function pick(file: File | undefined) {
    if (!file) return
    const text = await readText(file)
    setContent(text)
    setSourceType(sourceTypeFor(file.name))
    if (title === "") setTitle(file.name)
    if (source === "") setSource(file.name)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    setResult(null)
    const answer = await ingest.execute(payload)
    if (answer === undefined) return
    setResult(answer)
    // A failed ingest keeps the text, so you can fix the cause and delete the
    // failed copy; a ready one is done with it.
    if (answer.state === "ready") setContent("")
  }

  const conflict = ingest.error?.code === "CONFLICT"

  return (
    <section className="flex flex-col gap-4">
      <QueryBoundary title="Collection" query={collection} skeletonRows={1}>
        {(c) => (
          <PageHeader
            title="Ingest"
            description={`Paste text or pick a text file, and Weave chunks and embeds it into ${c.name} inside this request.`}
            actions={
              <PluginLink to={collectionPath(c.id)} className="text-sm underline">
                Back to {c.name}
              </PluginLink>
            }
          />
        )}
      </QueryBoundary>

      {result?.state === "ready" ? (
        <Alert>
          <AlertTitle>Ready: {plural(result.chunk_count, "chunk", "chunks")}.</AlertTitle>
          <AlertDescription>
            <PluginLink to={documentPath(result.document_id)} className="underline">
              Open the document
            </PluginLink>
          </AlertDescription>
        </Alert>
      ) : null}
      {result?.state === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>Ingest failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-1">
            <span className="font-mono text-xs break-all">{result.error ?? "Weave stored no reason."}</span>
            <span>The document row exists in state failed. Delete it before you ingest the same text again.</span>
            <PluginLink to={documentPath(result.document_id)} className="underline">
              Open the document
            </PluginLink>
          </AlertDescription>
        </Alert>
      ) : null}

      <CommandAlert title="Could not ingest" error={ingest.error} />
      {conflict ? (
        <div className="flex gap-4 text-sm">
          <PluginLink to={documentsHref({ collection_id: id, state: "failed" })} className="underline">
            Failed documents in this collection
          </PluginLink>
          <PluginLink to={documentsHref({ collection_id: id, state: "processing" })} className="underline">
            Processing documents in this collection
          </PluginLink>
        </div>
      ) : null}

      <form onSubmit={(e) => void submit(e)} className="flex max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-file">Pick a text file</Label>
          <Input id="ingest-file" type="file" accept=".txt,.md,.markdown,.html,.htm,.csv,.json" onChange={(e) => void pick(e.target.files?.[0])} />
          <p className="text-xs text-muted-foreground">The browser reads it as text. Nothing is uploaded until you press Ingest.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-content">Content</Label>
          <Textarea id="ingest-content" rows={12} className="font-mono text-xs" value={content} onChange={(e) => setContent(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            <span className="font-mono">{formatBytes(utf8Length(content))}</span> of 1 MiB.
          </p>
          {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ingest-title">Title</Label>
            <Input id="ingest-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ingest-source">Source</Label>
            <Input id="ingest-source" className="font-mono text-xs" spellCheck={false} value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ingest-type">Content type</Label>
          <NativeSelect id="ingest-type" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            {types.map((t) => (
              <NativeSelectOption key={t} value={t}>
                {t}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>This deployment's loader reads</span>
            <TagList values={supported} label="content types" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Metadata</span>
          <MetadataEditor rows={rows} onChange={setRows} />
          {"error" in meta ? <p role="alert" className="text-sm text-destructive">{meta.error}</p> : null}
        </div>
        <div>
          <Button type="submit" disabled={!canSubmit}>
            {ingest.loading ? "Ingesting…" : "Ingest"}
          </Button>
        </div>
      </form>
    </section>
  )
}
```

The size problem is computed from the exact payload `execute` will send, so a title or metadata that pushes the request over the limit counts too. Check `alert.tsx` has a `destructive` variant before relying on it; if it doesn't, use the default variant and keep the title "Ingest failed".

- [ ] **Step 5: Register the page**

In `src/index.tsx`, import and export `IngestPage` and add `{ path: "/collections/:id/ingest", element: IngestPage }` to `routes`.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS. The transport test pastes 800,000 characters; if it takes more than a few seconds under jsdom, lower the repeat to the smallest count that still escapes past 1 MiB (it must stay under `CONTENT_CAP` of content) and say so.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/ingest.ts packages/plugin-weave/src/pages/ingest.tsx packages/plugin-weave/test/ingest-limits.test.ts packages/plugin-weave/test/ingest.test.tsx
git commit --only -m "feat(plugin-weave): ingest pasted text or a picked file" -m "<body>" -- packages/plugin-weave/src/ingest.ts packages/plugin-weave/src/pages/ingest.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/ingest-limits.test.ts packages/plugin-weave/test/ingest.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: the page measures the encoded request before sending, so a file under Weave's 1 MiB cap that the transport would refuse is caught here with the setting your operator can raise, and a duplicate links to the failed and processing copies you might delete.

---

### Task 9: Documents page

**Files:**
- Create: `packages/plugin-weave/src/pages/documents.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/documents.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `Collection`, `DocumentRow`, `ListOutput` (types); `documentColumns` (Task 3); `useSearchParam`, `useSetSearchParams`, `withTenant`, `TenantFilter`, `useDebounced`, `pageOf`, `offsetFor`, `PAGE_SIZE`, `plural` (Task 1).
- Produces: `DocumentsPage`.

- [ ] **Step 1: Write the failing tests**

`test/documents.test.tsx`:

```tsx
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { NavigateOptions, PluginLinkProps, ScopedClient } from "@forge-go/dashboard-plugin"
import { DocumentsPage } from "../src/pages/documents"
import { scriptedClient } from "./harness"

const COL = "col_01k70000000000000000000001"
const GONE = "col_01k70000000000000000000777"

const COLLECTIONS = {
  items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }],
  total: 1,
  limit: 100,
  offset: 0,
}

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-07T09:00:00Z", updated_at: "2026-10-07T09:00:00Z",
    id: "doc_01k70000000000000000000001", collection_id: COL, tenant_id: "",
    title: "Refund policy", content_hash: "ab".repeat(32), content_length: 812, chunk_count: 6,
    metadata: {}, state: "ready", collection_name: "support-articles", stalled: false, ...over,
  }
}

const PAGE = { items: [doc()], total: 1, limit: 25, offset: 0 }
const EMPTY = { items: [], total: 0, limit: 25, offset: 0 }

/** The page reads its filters from the address, so navigation here really moves it. */
function renderAt(url: string, client: ScopedClient) {
  window.history.replaceState(null, "", url)
  const calls: { to: string; options?: NavigateOptions }[] = []
  const nav = {
    Link: ({ to, children }: PluginLinkProps): ReactNode => <a href={to}>{children}</a>,
    navigate: (to: string, options?: NavigateOptions) => {
      calls.push({ to, options })
      window.history.replaceState(null, "", to)
    },
  }
  render(
    <PluginProvider client={client}>
      <NavigationProvider value={nav}>
        <DocumentsPage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return calls
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("DocumentsPage", () => {
  it("asks for the newest documents of every tenant with no filters", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    expect(queried.find((q) => q.intent === "documents.list")?.params).toEqual({ limit: 25, offset: 0 })
    expect(screen.getByText("1 document")).toBeTruthy()
  })

  it("reads its collection and state from the address", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt(`/@weave/documents?collection_id=${COL}&state=failed`, client)
    await screen.findByText("Refund policy")
    expect(queried.find((q) => q.intent === "documents.list")?.params).toEqual({ limit: 25, offset: 0, collection_id: COL, state: "failed" })
    expect((screen.getByLabelText("State") as HTMLSelectElement).value).toBe("failed")
  })

  it("writes a changed filter to the address, replacing the entry", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    const calls = renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "processing" } })
    expect(calls).toEqual([{ to: "/@weave/documents?state=processing", options: { replace: true } }])
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, state: "processing" }))
  })

  it("sends tenant only when one is picked", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "named" } })
    fireEvent.change(screen.getByLabelText("Tenant ID"), { target: { value: "acme" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, tenant: "acme" }))
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "all" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0 }))
  })

  it("searches titles after typing stops", async () => {
    const { client, queried } = scriptedClient({ "documents.list": PAGE, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    await screen.findByText("Refund policy")
    fireEvent.change(screen.getByLabelText("Search documents"), { target: { value: "refund" } })
    await waitFor(() => expect(queried.at(-1)?.params).toEqual({ limit: 25, offset: 0, search: "refund" }))
  })

  it("says the filters matched nothing and offers to clear them", async () => {
    const { client } = scriptedClient({ "documents.list": EMPTY, "collections.list": COLLECTIONS })
    const calls = renderAt(`/@weave/documents?collection_id=${GONE}`, client)
    expect(await screen.findByText("No documents match these filters.")).toBeTruthy()
    expect(screen.getByText("0 documents")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }))
    expect(calls.at(-1)).toEqual({ to: "/@weave/documents", options: { replace: true } })
  })

  it("keeps a collection from the address in the picker even when it isn't listed", async () => {
    const { client } = scriptedClient({ "documents.list": EMPTY, "collections.list": COLLECTIONS })
    renderAt(`/@weave/documents?collection_id=${GONE}`, client)
    await screen.findByText("No documents match these filters.")
    expect((screen.getByLabelText("Collection") as HTMLSelectElement).value).toBe(GONE)
  })

  it("says nothing exists yet when it was not filtered", async () => {
    const { client } = scriptedClient({ "documents.list": EMPTY, "collections.list": COLLECTIONS })
    renderAt("/@weave/documents", client)
    expect(await screen.findByText(/No documents yet/)).toBeTruthy()
  })

  it("marks a stalled row with its age", async () => {
    const { client } = scriptedClient({
      "documents.list": { ...PAGE, items: [doc({ state: "processing", stalled: true, updated_at: "2026-10-07T06:00:00Z" })] },
      "collections.list": COLLECTIONS,
    })
    renderAt("/@weave/documents", client)
    expect(await screen.findByText(/no update for/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Documents fourth in the RAG group and routes a document's page", () => {
    const nav = weavePlugin.nav?.find((n) => n.label === "Documents")
    expect(nav?.to).toBe("/documents")
    expect(nav?.priority).toBe(20)
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/documents")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the page**

`src/pages/documents.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable } from "@forge-go/dashboard-kit/components/resource-table"
import { documentColumns } from "../components/document-columns"
import { TenantFilter } from "../components/tenant-filter"
import { plural } from "../format"
import { useSearchParam, useSetSearchParams } from "../links"
import { PAGE_SIZE, offsetFor, pageOf } from "../paging"
import { withTenant } from "../tenant"
import type { Collection, DocumentRow, ListOutput } from "../types"
import { useDebounced } from "../use-debounced"

const columns = documentColumns({ withCollection: true })

const STATES = [
  { label: "Any state", value: "" },
  { label: "Ready", value: "ready" },
  { label: "Pending", value: "pending" },
  { label: "Processing", value: "processing" },
  { label: "Failed", value: "failed" },
]

/**
 * Collection and state live in the address, so a link from an ingest
 * conflict or a collection page lands filtered. Search, tenant and paging are
 * the page's own.
 */
export const DocumentsPage: ComponentType<PluginPageProps> = () => {
  const collectionId = useSearchParam("collection_id")
  const state = useSearchParam("state")
  const setParams = useSetSearchParams("/documents")
  const [search, setSearch] = useState("")
  const [tenant, setTenant] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)
  // Bumped by "Clear filters" so the tenant picker forgets its own mode.
  const [clears, setClears] = useState(0)
  const term = useDebounced(search.trim(), 300)

  const collections = useQuery<ListOutput<Collection>>("collections.list", { limit: 100 })
  const params = withTenant(
    {
      limit: PAGE_SIZE,
      offset,
      ...(collectionId !== "" ? { collection_id: collectionId } : {}),
      ...(state !== "" ? { state } : {}),
      ...(term !== "" ? { search: term } : {}),
    },
    tenant,
  )
  const list = useQuery<ListOutput<DocumentRow>>("documents.list", params)
  const filtered = collectionId !== "" || state !== "" || term !== "" || tenant !== null

  const known = collections.data?.items ?? []
  const options = [
    { label: "All collections", value: "" },
    ...known.map((c) => ({ label: c.name, value: c.id })),
    // A collection named by the address that the picker doesn't list, such
    // as a deleted one, stays selected rather than silently becoming "all".
    ...(collectionId !== "" && !known.some((c) => c.id === collectionId) ? [{ label: collectionId, value: collectionId }] : []),
  ]

  function clear() {
    setSearch("")
    setTenant(null)
    setClears((n) => n + 1)
    setOffset(0)
    setParams({ collection_id: "", state: "" })
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Documents" description="Newest first. A document's state is where its ingest got to." />
      <FilterBar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v)
            setOffset(0)
          },
          placeholder: "Search titles",
          label: "Search documents",
        }}
        filters={[
          {
            id: "collection",
            label: "Collection",
            value: collectionId,
            options,
            onChange: (v) => {
              setOffset(0)
              setParams({ collection_id: v })
            },
          },
          {
            id: "state",
            label: "State",
            value: state,
            options: STATES,
            onChange: (v) => {
              setOffset(0)
              setParams({ state: v })
            },
          },
        ]}
        actions={
          <TenantFilter
            key={clears}
            value={tenant}
            onChange={(t) => {
              setTenant(t)
              setOffset(0)
            }}
          />
        }
      />
      <QueryBoundary title="Documents" query={list} keepPreviousData>
        {(data) => (
          <ResourceTable<DocumentRow>
            columns={columns}
            rows={data.items}
            rowKey={(d) => d.id}
            caption={plural(data.total, "document", "documents")}
            emptyMessage={filtered ? "No documents match these filters." : "No documents yet. Open a collection and ingest one."}
            emptyAction={
              filtered ? (
                <Button variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              ) : undefined
            }
            pagination={pageOf(data)}
            onPageChange={(page) => setOffset(offsetFor(page, data.limit))}
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

`TenantFilter` keeps its own mode, so "Clear filters" remounts it through `key`. The key changes only on a clear, never while you type a tenant name, so the input you are typing in is never remounted under you.

- [ ] **Step 4: Register the page**

In `src/index.tsx`, import `FileTextIcon` and `DocumentsPage`, export `DocumentsPage`, add `{ label: "Documents", to: "/documents", priority: 20, icon: <FileTextIcon />, group: "RAG" }` to `nav` and `{ path: "/documents", element: DocumentsPage }` to `routes`.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/pages/documents.tsx packages/plugin-weave/test/documents.test.tsx
git commit --only -m "feat(plugin-weave): add the documents page" -m "<body>" -- packages/plugin-weave/src/pages/documents.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/documents.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: collection and state live in the address, so a link from a duplicate ingest lands filtered, and an empty filtered page says nothing matched and offers to clear the filters rather than claiming there are no documents.

---
### Task 10: Document detail, the span map and the lazy chunk reader

**Files:**
- Create: `packages/plugin-weave/src/spans.ts`, `src/components/span-map.tsx`, `src/components/chunk-reader.tsx`, `src/pages/document-detail.tsx`
- Modify: `packages/plugin-weave/src/index.tsx` (a lazy route)
- Test: `packages/plugin-weave/test/spans.test.ts`, `test/document-detail.test.tsx`, `test/lazy-chunks.test.ts`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `DocumentRow`, `SpansOutput`, `Span`, `Chunk`, `ListOutput`, `IdOutput` (types); `DocumentStateCell`; `MetadataList`; `Id`; `collectionPath`, `chunkPath`, `formatBytes`, `formatCount`, `formatAge`, `ageSeconds`, `plural`, `utf8Length` (Task 1).
- Produces: `layoutSpans(spans)`, `overlapsByIndex(spans)`, `splitAtByte(text, n)` from `src/spans.ts`; `SpanMap({ spans })`; `ChunkReader({ documentId, total, overlaps })` (default export); `DocumentDetailPage` (named and default export). Task 11 reuses nothing from here.

The document page is the only lazy route. It is the one page that imports the chunk reader, and the chunk reader is the only file that names `@tanstack/react-virtual`, so the virtualiser stays out of the shell's entry chunk. `test/lazy-chunks.test.ts` pins all three facts.

- [ ] **Step 1: Write the failing tests**

`test/spans.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { layoutSpans, overlapsByIndex, splitAtByte } from "../src/spans"

const span = (index: number, start: number, end: number) => ({ id: `chk_${index}`, index, start_offset: start, end_offset: end, token_count: Math.floor((end - start) / 4) })

describe("layoutSpans", () => {
  it("scales to the largest end offset and places each chunk as a percentage", () => {
    const layout = layoutSpans([span(0, 0, 100), span(1, 80, 200)])
    expect(layout.scale).toBe(200)
    expect(layout.segments.map((s) => [s.left, s.width])).toEqual([[0, 50], [40, 60]])
  })

  it("measures each chunk's overlap with the one before it", () => {
    const layout = layoutSpans([span(0, 0, 100), span(1, 80, 200), span(2, 200, 260)])
    expect(layout.segments.map((s) => s.overlap)).toEqual([0, 20, 0])
  })

  it("finds the bytes no chunk covers, including a leading gap", () => {
    const layout = layoutSpans([span(0, 10, 100), span(1, 120, 200)])
    expect(layout.gaps).toEqual([{ start: 0, end: 10 }, { start: 100, end: 120 }])
  })

  it("has nothing to draw for no spans", () => {
    expect(layoutSpans([])).toEqual({ scale: 0, segments: [], gaps: [] })
  })
})

describe("overlapsByIndex", () => {
  it("maps each chunk index to its overlap with the previous chunk", () => {
    const map = overlapsByIndex([span(0, 0, 100), span(1, 80, 200)])
    expect(map.get(0)).toBe(0)
    expect(map.get(1)).toBe(20)
  })
})

describe("splitAtByte", () => {
  it("splits on a byte count without cutting a character in two", () => {
    expect(splitAtByte("abcdef", 2)).toEqual(["ab", "cdef"])
    expect(splitAtByte("é€x", 3)).toEqual(["é", "€x"])
    expect(splitAtByte("abc", 0)).toEqual(["", "abc"])
    expect(splitAtByte("abc", 10)).toEqual(["abc", ""])
  })
})
```

`test/document-detail.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { DocumentDetailPage } from "../src/pages/document-detail"
import { renderWithNavigate, scriptedClient } from "./harness"

const DOC = "doc_01k70000000000000000000002"
const COL = "col_01k70000000000000000000001"
const HASH = "9f2c".repeat(16)

function doc(over: Record<string, unknown> = {}) {
  return {
    created_at: "2026-10-05T09:00:00Z", updated_at: "2026-10-05T09:00:00Z",
    id: DOC, collection_id: COL, tenant_id: "", title: "Shipping FAQ",
    source: "https://help.example.com/shipping.html", source_type: "text/html",
    content_hash: HASH, content_length: 9000, chunk_count: 3, metadata: { lang: "en" },
    state: "ready", collection_name: "support-articles", stalled: false, ...over,
  }
}

const SPANS = {
  document_id: DOC,
  content_length: 9000,
  spans: [
    { id: "chk_01k70000000000000000000110", index: 0, start_offset: 0, end_offset: 192, token_count: 48 },
    { id: "chk_01k70000000000000000000111", index: 1, start_offset: 160, end_offset: 352, token_count: 48 },
    { id: "chk_01k70000000000000000000112", index: 2, start_offset: 368, end_offset: 448, token_count: 20 },
  ],
  total: 3,
  complete: true,
}

const CHUNKS = {
  items: [
    { id: "chk_01k70000000000000000000110", document_id: DOC, collection_id: COL, tenant_id: "", content: "Standard shipping takes three to five working days.", index: 0, start_offset: 0, end_offset: 192, token_count: 48, metadata: {}, created_at: "2026-10-05T09:00:00Z" },
    { id: "chk_01k70000000000000000000111", document_id: DOC, collection_id: COL, tenant_id: "", content: "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 and express arrives the next working day.", index: 1, start_offset: 160, end_offset: 352, token_count: 48, metadata: {}, created_at: "2026-10-05T09:00:00Z" },
    { id: "chk_01k70000000000000000000112", document_id: DOC, collection_id: COL, tenant_id: "", content: "Orders over 50 euros ship free.", index: 2, start_offset: 368, end_offset: 448, token_count: 20, metadata: {}, created_at: "2026-10-05T09:00:00Z" },
  ],
  total: 3,
  limit: 100,
  offset: 0,
}

function queries(over: Record<string, unknown> = {}) {
  return { "documents.get": doc(), "documents.spans": SPANS, "chunks.list": CHUNKS, ...over }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("DocumentDetailPage", () => {
  it("reads the document, its spans and its first page of chunks", async () => {
    const { client, queried } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    await screen.findByRole("heading", { name: "Shipping FAQ" })
    expect(queried).toContainEqual({ intent: "documents.get", params: { id: DOC } })
    expect(queried).toContainEqual({ intent: "documents.spans", params: { id: DOC } })
    await waitFor(() => expect(queried).toContainEqual({ intent: "chunks.list", params: { document_id: DOC, limit: 100, offset: 0 } }))
  })

  it("shows the full hash and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect((await screen.findByText(HASH)).className).toContain("font-mono")
    fireEvent.click(screen.getByRole("button", { name: "Copy the content hash" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH))
    expect(await screen.findByText("Copied")).toBeTruthy()
  })

  it("links its collection and names its size as the raw input", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect((await screen.findByRole("link", { name: "support-articles" })).getAttribute("href")).toBe(`/collections/${COL}`)
    expect(screen.getByText("9,000 B")).toBeTruthy()
  })

  it("shows a failed document's stored error in an alert", async () => {
    const { client } = scriptedClient(queries({ "documents.get": doc({ state: "failed", chunk_count: 0, error: "vector upsert: connection refused" }) }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Ingest failed")).toBeTruthy()
    expect(screen.getByText("vector upsert: connection refused")).toBeTruthy()
  })

  it("says a stalled document looks stalled, with its age, and does not call it dead", async () => {
    const { client } = scriptedClient(queries({ "documents.get": doc({ state: "processing", stalled: true, updated_at: "2020-01-01T00:00:00Z" }) }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Looks stalled")).toBeTruthy()
    expect(screen.queryByText(/dead/i)).toBeNull()
  })

  it("draws each chunk as a byte range linked to the chunk, and names the gap", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    const map = await screen.findByRole("img", { name: /3 chunks over 448 B/ })
    expect(within(map).getByRole("link", { name: "Chunk 1, bytes 160 to 352" }).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000111")
    expect(screen.getByText("Bytes 352 to 368 are in no chunk.")).toBeTruthy()
  })

  it("says the raw input and the chunk offsets don't share a scale when a loader changed the text", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText(/a loader changed the text/)).toBeTruthy()
  })

  it("says when it shows only the first spans", async () => {
    const { client } = scriptedClient(queries({ "documents.spans": { ...SPANS, total: 7000, complete: false } }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Showing the first 3 of 7,000 chunks.")).toBeTruthy()
  })

  it("reads every chunk in order with its overlap marked", async () => {
    const { client } = scriptedClient(queries())
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText("Standard shipping takes three to five working days.")).toBeTruthy()
    const mark = await screen.findByTitle("Overlaps the previous chunk")
    expect(mark.textContent).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
  })

  it("deletes after confirming, then leaves for the documents list", async () => {
    const { client, sent } = scriptedClient(queries(), { "documents.delete": { id: DOC } })
    const { navigate } = renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete document" }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/documents", { replace: true }))
    expect(sent).toEqual([{ intent: "documents.delete", payload: { id: DOC } }])
  })

  it("keeps a failed delete inside the dialog", async () => {
    const { client } = scriptedClient(queries(), { "documents.delete": new ContractError("NOT_FOUND", "document not found") })
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete document" }))
    expect(await within(dialog).findByText("document not found")).toBeTruthy()
  })

  it("shows an error card for a document that doesn't exist", async () => {
    const { client } = scriptedClient(queries({ "documents.get": new ContractError("NOT_FOUND", "document not found") }))
    renderWithNavigate(DocumentDetailPage, client, { id: DOC })
    expect(await screen.findByText(/document not found/)).toBeTruthy()
  })
})
```

`test/lazy-chunks.test.ts`:

```ts
import { describe, expect, it } from "vitest"

/**
 * The chunk reader carries a virtualiser. It must not reach the shell's entry
 * chunk, and every page test would still pass if it did. So this reads the
 * sources and checks how they import each other. Read through
 * import.meta.glob, not node:fs, because this package's tsconfig has no Node
 * types.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", eager: true })

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

function importersOf(pattern: RegExp): string[] {
  return Object.entries(modules)
    .filter(([, mod]) => pattern.test(sourceOf(mod)))
    .map(([path]) => path)
    .sort()
}

describe("the chunk reader stays out of the entry", () => {
  it("found the sources", () => {
    expect(modules["../src/pages/document-detail.tsx"]).toBeDefined()
    expect(modules["../src/components/chunk-reader.tsx"]).toBeDefined()
  })

  it("reaches the document page from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/document-detail"\)\)/)
    expect(entry).not.toMatch(/^import (?!type)[^\n]*["']\.\/pages\/document-detail["']/m)
  })

  it("imports the document page from nowhere else", () => {
    const others = importersOf(/from\s+["'][./]*pages\/document-detail["']/).filter((p) => p !== "../src/index.tsx")
    expect(others).toEqual([])
  })

  it("names the virtualiser only in the chunk reader, which only the document page imports", () => {
    expect(importersOf(/@tanstack\/react-virtual/)).toEqual(["../src/components/chunk-reader.tsx"])
    expect(importersOf(/from\s+["'][./]*components\/chunk-reader["']/)).toEqual(["../src/pages/document-detail.tsx"])
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("routes a document's page lazily", () => {
    const route = weavePlugin.routes.find((r) => r.path === "/documents/:id")
    expect(route).toBeDefined()
    // A React.lazy component is an object with the lazy marker, not a function.
    expect(typeof route?.element).toBe("object")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/spans.ts`**

```ts
import { utf8Length } from "./format"
import type { Span } from "./types"

export interface Segment {
  span: Span
  /** Percent of the bar. */
  left: number
  width: number
  /** Bytes shared with the previous chunk. */
  overlap: number
}

export interface Gap {
  start: number
  end: number
}

export interface SpanLayout {
  /** The largest end offset: the bar's full width, in bytes. */
  scale: number
  segments: Segment[]
  gaps: Gap[]
}

/**
 * Chunks as byte ranges along a bar scaled to the largest end_offset, not to
 * content_length: content_length is the raw input, and once a loader has
 * changed the text the offsets are on a different scale.
 */
export function layoutSpans(spans: Span[]): SpanLayout {
  const scale = spans.reduce((m, s) => Math.max(m, s.end_offset), 0)
  if (scale === 0) return { scale: 0, segments: [], gaps: [] }
  const byIndex = [...spans].sort((a, b) => a.index - b.index)
  const segments = byIndex.map((span, i) => {
    const prev = byIndex[i - 1]
    return {
      span,
      left: (span.start_offset / scale) * 100,
      width: (Math.max(0, span.end_offset - span.start_offset) / scale) * 100,
      overlap: prev ? Math.max(0, prev.end_offset - span.start_offset) : 0,
    }
  })
  const gaps: Gap[] = []
  let covered = 0
  for (const s of [...spans].sort((a, b) => a.start_offset - b.start_offset)) {
    if (s.start_offset > covered) gaps.push({ start: covered, end: s.start_offset })
    covered = Math.max(covered, s.end_offset)
  }
  return { scale, segments, gaps }
}

export function overlapsByIndex(spans: Span[]): Map<number, number> {
  return new Map(layoutSpans(spans).segments.map((s) => [s.span.index, s.overlap]))
}

/** The longest prefix of `text` that fits in `n` UTF-8 bytes, and the rest. */
export function splitAtByte(text: string, n: number): [string, string] {
  if (n <= 0) return ["", text]
  let bytes = 0
  let cut = 0
  for (const ch of text) {
    const b = utf8Length(ch)
    if (bytes + b > n) break
    bytes += b
    cut += ch.length
  }
  return [text.slice(0, cut), text.slice(cut)]
}
```

- [ ] **Step 4: Write the span map**

`src/components/span-map.tsx`:

```tsx
import { PluginLink } from "@forge-go/dashboard-plugin"
import { formatBytes, formatCount, plural } from "../format"
import { chunkPath } from "../links"
import { layoutSpans } from "../spans"
import type { SpansOutput } from "../types"

/**
 * A document's chunks as byte ranges. Overlap with the previous chunk is
 * shaded, and bytes no chunk covers are marked and listed.
 */
export function SpanMap({ spans }: { spans: SpansOutput }) {
  if (spans.total === 0) return <p className="text-sm text-muted-foreground">This document has no chunks.</p>
  const layout = layoutSpans(spans.spans)
  const loaderChanged = spans.content_length !== layout.scale

  return (
    <figure className="flex flex-col gap-2">
      <div
        role="img"
        aria-label={`${plural(spans.spans.length, "chunk", "chunks")} over ${formatBytes(layout.scale)}`}
        className="relative h-8 w-full overflow-hidden rounded bg-muted"
      >
        {layout.segments.map((s, i) => (
          // PluginLink takes a className and no style, so a positioned span
          // carries the geometry and the link fills it.
          <span key={s.span.id} className="absolute top-1 h-6" style={{ left: `${s.left}%`, width: `${s.width}%` }}>
            <PluginLink
              to={chunkPath(s.span.id)}
              className={`block h-full w-full border-x border-background ${i % 2 === 0 ? "bg-primary/60" : "bg-primary/35"}`}
            >
              <span className="sr-only">
                Chunk {s.span.index}, bytes {s.span.start_offset} to {s.span.end_offset}
              </span>
            </PluginLink>
          </span>
        ))}
        {layout.segments
          .filter((s) => s.overlap > 0)
          .map((s) => (
            <span
              key={`overlap-${s.span.id}`}
              aria-hidden
              className="pointer-events-none absolute top-1 h-6 bg-foreground/25"
              style={{ left: `${s.left}%`, width: `${(s.overlap / layout.scale) * 100}%` }}
            />
          ))}
        {layout.gaps.map((g) => (
          <span
            key={`gap-${g.start}`}
            aria-hidden
            className="pointer-events-none absolute top-0 h-8 bg-destructive/60"
            style={{ left: `${(g.start / layout.scale) * 100}%`, width: `${Math.max(0.3, ((g.end - g.start) / layout.scale) * 100)}%` }}
          />
        ))}
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Offsets are byte offsets into the text after loading and trimming, and the semantic and code chunkers only approximate them. The
        bar runs to the last chunk's end, byte {formatCount(layout.scale)}. Shaded parts overlap the chunk before.{" "}
        {loaderChanged
          ? `The raw input was ${formatBytes(spans.content_length)}; a loader changed the text, so the two don't share a scale.`
          : null}
      </figcaption>
      {layout.gaps.map((g) => (
        <p key={`gap-text-${g.start}`} className="text-sm">
          Bytes {formatCount(g.start)} to {formatCount(g.end)} are in no chunk.
        </p>
      ))}
      {!spans.complete ? (
        <p className="text-sm">
          Showing the first {formatCount(spans.spans.length)} of {plural(spans.total, "chunk", "chunks")}.
        </p>
      ) : null}
    </figure>
  )
}
```

Each link's accessible name is its sr-only text, exactly `Chunk <index>, bytes <start> to <end>`, which is what the test finds it by.

- [ ] **Step 5: Write the chunk reader**

`src/components/chunk-reader.tsx`:

```tsx
import { useRef } from "react"
import { observeElementRect, useVirtualizer } from "@tanstack/react-virtual"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import { formatCount } from "../format"
import { chunkPath } from "../links"
import { splitAtByte } from "../spans"
import type { Chunk, ListOutput } from "../types"

const PAGE = 100
const ROW_HEIGHT = 112
const INITIAL_RECT = { width: 0, height: 512 }

/**
 * One chunk, read from the page of 100 it belongs to. Every row on a page
 * asks the same question, so the shared query store sends one request per
 * page, and only for the pages you scroll to.
 */
function ChunkRow({ documentId, index, overlap }: { documentId: string; index: number; overlap: number }) {
  const offset = Math.floor(index / PAGE) * PAGE
  const page = useQuery<ListOutput<Chunk>>("chunks.list", { document_id: documentId, limit: PAGE, offset })
  if (page.error) return <p className="py-2 text-sm text-destructive">{page.error.message}</p>
  const chunk = page.data?.items[index - offset]
  if (!chunk) return <div aria-busy="true" className="my-2 h-16 animate-pulse rounded bg-muted" />
  const [shared, rest] = splitAtByte(chunk.content, overlap)
  return (
    <article className="flex flex-col gap-1 border-b py-2">
      <header className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <PluginLink to={chunkPath(chunk.id)} className="font-mono text-xs underline-offset-4 hover:underline">
          #{chunk.index}
        </PluginLink>
        <span className="font-mono">
          bytes {formatCount(chunk.start_offset)} to {formatCount(chunk.end_offset)}
        </span>
        <span>about {formatCount(chunk.token_count)} tokens</span>
      </header>
      <p className="whitespace-pre-wrap text-sm">
        {shared !== "" ? (
          <mark title="Overlaps the previous chunk" className="rounded-sm bg-muted px-0.5 text-foreground">
            {shared}
          </mark>
        ) : null}
        {rest}
      </p>
    </article>
  )
}

/** Every chunk's full text in order, virtualised, with overlap highlighted. */
export default function ChunkReader({ documentId, total, overlaps }: { documentId: string; total: number; overlaps: Map<number, number> }) {
  const scroller = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
    initialRect: INITIAL_RECT,
    // jsdom answers a height of 0 once the scroller mounts, which would leave
    // no rows at all. A real reader is never 0 tall, so keep the start size.
    observeElementRect: (instance, cb) => observeElementRect(instance, (rect) => cb(rect.height > 0 ? rect : INITIAL_RECT)),
  })

  if (total === 0) return <p className="text-sm text-muted-foreground">No chunks to read.</p>

  return (
    <div ref={scroller} className="h-[32rem] overflow-auto rounded-md border px-3" aria-label="Chunk reader">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
          >
            <ChunkRow documentId={documentId} index={item.index} overlap={overlaps.get(item.index) ?? 0} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

Overlap is known only for the first 5,000 chunks, the ones `documents.spans` returns. Past that a chunk is shown without a highlight, which is the honest default.

- [ ] **Step 6: Write the page**

`src/pages/document-detail.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { DocumentStateCell } from "../badges"
import ChunkReader from "../components/chunk-reader"
import { Id } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { SpanMap } from "../components/span-map"
import { ageSeconds, formatAge, formatBytes, formatCount } from "../format"
import { collectionPath } from "../links"
import { overlapsByIndex } from "../spans"
import type { DocumentRow, IdOutput, SpansOutput } from "../types"

function CopyHash({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Copy the content hash"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setState("copied")
          } catch {
            setState("failed")
          }
        }}
      >
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      {state === "failed" ? (
        <span role="status" className="text-xs text-destructive">
          The browser refused the clipboard. Select the hash and copy it yourself.
        </span>
      ) : null}
    </span>
  )
}

export const DocumentDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const document = useQuery<DocumentRow>("documents.get", { id })
  const spans = useQuery<SpansOutput>("documents.spans", { id })
  const remove = useCommand<IdOutput>("documents.delete")
  const navigateTo = useNavigateTo()
  const [confirming, setConfirming] = useState(false)

  async function runDelete() {
    const result = await remove.execute({ id })
    if (result === undefined) return
    navigateTo("/documents", { replace: true })
  }

  return (
    // keepPreviousData: the delete dialog lives inside, and a refetch (a tab
    // regaining focus) must not swap in the skeleton and unmount it.
    <QueryBoundary title="Document" query={document} skeletonRows={8} keepPreviousData>
      {(d) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={d.title ?? "Untitled document"}
            description={d.source}
            actions={
              <Button
                variant="destructive"
                onClick={() => {
                  remove.reset()
                  setConfirming(true)
                }}
              >
                Delete
              </Button>
            }
          />

          {d.state === "failed" ? (
            <Alert variant="destructive">
              <AlertTitle>Ingest failed</AlertTitle>
              <AlertDescription>
                <span className="font-mono text-xs break-all">{d.error ?? "Weave stored no reason."}</span>
              </AlertDescription>
            </Alert>
          ) : null}
          {d.stalled ? (
            <Alert>
              <AlertTitle>Looks stalled</AlertTitle>
              <AlertDescription>
                Still processing with no update for {formatAge(ageSeconds(d.updated_at))}. Ingest runs inside one request, so the process
                that was ingesting it has probably gone, but Weave has no heartbeat to say for sure. Delete it and ingest it again.
              </AlertDescription>
            </Alert>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Details</h2>
            <DescriptionList
              items={[
                { term: "ID", value: <Id value={d.id} /> },
                {
                  term: "Collection",
                  value:
                    d.collection_name !== "" ? (
                      <PluginLink to={collectionPath(d.collection_id)} className="underline-offset-4 hover:underline">
                        {d.collection_name}
                      </PluginLink>
                    ) : (
                      <span className="text-sm text-muted-foreground">deleted collection</span>
                    ),
                },
                { term: "Tenant", value: d.tenant_id !== "" ? <Id value={d.tenant_id} /> : <NoneCell label="tenant" /> },
                { term: "State", value: <DocumentStateCell doc={d} /> },
                { term: "Content type", value: d.source_type ? <Id value={d.source_type} /> : <NoneCell label="content type" /> },
                {
                  term: "Size",
                  value: (
                    <span>
                      <span className="font-mono text-xs">{formatBytes(d.content_length)}</span>
                      <span className="text-muted-foreground"> of raw input, before any loader ran</span>
                    </span>
                  ),
                },
                { term: "Chunks", value: <span className="tabular-nums">{formatCount(d.chunk_count)}</span> },
                { term: "Created", value: <Timestamp value={d.created_at} label="creation date" /> },
                { term: "Updated", value: <Timestamp value={d.updated_at} label="update" /> },
                {
                  term: "Content hash",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <Id value={d.content_hash} />
                      <CopyHash value={d.content_hash} />
                    </span>
                  ),
                },
              ]}
            />
            <p className="text-xs text-muted-foreground">Weave keeps this hash and the length, never the source text.</p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Metadata</h2>
            <MetadataList metadata={d.metadata} />
          </section>

          <QueryBoundary title="Chunks" query={spans} skeletonRows={3}>
            {(s) => (
              <>
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Where the chunks fall</h2>
                  <SpanMap spans={s} />
                </section>
                <section className="flex flex-col gap-2">
                  <h2 className="text-sm font-medium">Read the chunks</h2>
                  <ChunkReader documentId={d.id} total={s.total} overlaps={overlapsByIndex(s.spans)} />
                </section>
              </>
            )}
          </QueryBoundary>

          <ConfirmDialog
            open={confirming}
            onOpenChange={(next) => {
              if (!next && remove.loading) return
              setConfirming(next)
            }}
            title={`Delete ${d.title ?? "this document"}?`}
            description="This deletes the document with its chunks and their vectors. You can't undo it."
            confirmLabel="Delete document"
            pending={remove.loading}
            onConfirm={() => void runDelete()}
          >
            <CommandAlert title="Could not delete the document" error={remove.error} />
          </ConfirmDialog>
        </section>
      )}
    </QueryBoundary>
  )
}

export default DocumentDetailPage
```

`chunk_count` on a failed document reads 0 while its chunk rows may still exist (a vector upsert failure leaves them). The span map and the reader read the rows through `documents.spans`, so they show those chunks; that is the truth, and the 0 is what the ingest answered.

- [ ] **Step 7: Register the lazy route**

In `src/index.tsx`:

```tsx
import { lazy } from "react"
```

and, below the static imports:

```tsx
/**
 * The document page. Lazy, so the chunk reader's virtualiser never reaches
 * the shell's entry chunk. PluginHost wraps every page in Suspense, which is
 * what makes a lazy route legal.
 */
const DocumentDetailPage = lazy(() => import("./pages/document-detail"))
```

Add `{ path: "/documents/:id", element: DocumentDetailPage }` to `routes`. Do not re-export `DocumentDetailPage` from `index.tsx`, and do not import `./pages/document-detail` statically anywhere.

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS. If `PluginRoute.element`'s type rejects a lazy component, check how `plugin-trove/src/index.tsx` registers its lazy `BrowserPage`, which already type-checks, and do the same.

- [ ] **Step 9: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/spans.ts packages/plugin-weave/src/components/span-map.tsx packages/plugin-weave/src/components/chunk-reader.tsx packages/plugin-weave/src/pages/document-detail.tsx packages/plugin-weave/test/spans.test.ts packages/plugin-weave/test/document-detail.test.tsx packages/plugin-weave/test/lazy-chunks.test.ts
git commit --only -m "feat(plugin-weave): add a document's page with its span map and chunk reader" -m "<body>" -- packages/plugin-weave/src/spans.ts packages/plugin-weave/src/components/span-map.tsx packages/plugin-weave/src/components/chunk-reader.tsx packages/plugin-weave/src/pages/document-detail.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/spans.test.ts packages/plugin-weave/test/document-detail.test.tsx packages/plugin-weave/test/lazy-chunks.test.ts packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: the span map scales to the last chunk's end rather than the raw input, shades each chunk's overlap with the one before and lists the bytes no chunk covers, and the reader loads lazily so its virtualiser stays out of the entry chunk.

---

### Task 11: Chunks page and chunk detail

**Files:**
- Create: `packages/plugin-weave/src/pages/chunks.tsx`, `src/pages/chunk-detail.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/chunks.test.tsx`, `test/chunk-detail.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `Chunk`, `ChunkDetail`, `Collection`, `ListOutput` (types); `useSearchParam`, `useSetSearchParams`, `chunkPath`, `documentPath`, `collectionPath`, `pageOf`, `offsetFor`, `PAGE_SIZE`, `Id`, `IdLink`, `MetadataList`, `formatCount`, `isRealTime`, `plural` (Task 1).
- Produces: `ChunksPage`, `ChunkDetailPage`.

- [ ] **Step 1: Write the failing tests**

`test/chunks.test.tsx`:

```tsx
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { NavigateOptions, PluginLinkProps, ScopedClient } from "@forge-go/dashboard-plugin"
import { ChunksPage } from "../src/pages/chunks"
import { scriptedClient } from "./harness"

const COL = "col_01k70000000000000000000001"

const COLLECTIONS = { items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }], total: 1, limit: 100, offset: 0 }

const CHUNKS = {
  items: [
    {
      id: "chk_01k70000000000000000000100", document_id: "doc_01k70000000000000000000001", collection_id: COL, tenant_id: "",
      content: "Refunds are issued within 14 days of the return reaching our warehouse.", index: 0,
      start_offset: 0, end_offset: 192, token_count: 48, metadata: {}, created_at: "2026-10-04T09:00:00Z",
    },
  ],
  total: 21,
  limit: 25,
  offset: 0,
}

function renderAt(url: string, client: ScopedClient) {
  window.history.replaceState(null, "", url)
  const calls: { to: string; options?: NavigateOptions }[] = []
  render(
    <PluginProvider client={client}>
      <NavigationProvider
        value={{
          Link: ({ to, children }: PluginLinkProps): ReactNode => <a href={to}>{children}</a>,
          navigate: (to: string, options?: NavigateOptions) => {
            calls.push({ to, options })
            window.history.replaceState(null, "", to)
          },
        }}
      >
        <ChunksPage params={{}} />
      </NavigationProvider>
    </PluginProvider>,
  )
  return calls
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("ChunksPage", () => {
  it("asks for a collection first and lists nothing until it has one", async () => {
    const { client, queried } = scriptedClient({ "collections.list": COLLECTIONS, "chunks.list": CHUNKS })
    renderAt("/@weave/chunks", client)
    expect(await screen.findByText("Pick a collection")).toBeTruthy()
    expect(queried.some((q) => q.intent === "chunks.list")).toBe(false)
  })

  it("pages the chunks of the collection in the address, in reading order", async () => {
    const { client, queried } = scriptedClient({ "collections.list": COLLECTIONS, "chunks.list": CHUNKS })
    renderAt(`/@weave/chunks?collection_id=${COL}`, client)
    await screen.findByText(/Refunds are issued within 14 days/)
    expect(queried.find((q) => q.intent === "chunks.list")?.params).toEqual({ collection_id: COL, limit: 25, offset: 0 })
    expect(screen.getByText("21 chunks")).toBeTruthy()
    const row = screen.getAllByRole("row").find((r) => within(r).queryByText(/Refunds are issued/))!
    expect(within(row).getByText("chk_01k70000000000000000000100").className).toContain("font-mono")
    expect(within(row).getByText("0 to 192")).toBeTruthy()
  })

  it("writes a picked collection to the address", async () => {
    const { client } = scriptedClient({ "collections.list": COLLECTIONS, "chunks.list": CHUNKS })
    const calls = renderAt("/@weave/chunks", client)
    await screen.findByText("Pick a collection")
    fireEvent.change(screen.getByLabelText("Collection"), { target: { value: COL } })
    expect(calls).toEqual([{ to: `/@weave/chunks?collection_id=${COL}`, options: { replace: true } }])
    expect(await screen.findByText(/Refunds are issued within 14 days/)).toBeTruthy()
  })

  it("says a collection has no chunks yet", async () => {
    const { client } = scriptedClient({ "collections.list": COLLECTIONS, "chunks.list": { items: [], total: 0, limit: 25, offset: 0 } })
    renderAt(`/@weave/chunks?collection_id=${COL}`, client)
    expect(await screen.findByText("0 chunks")).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/This collection has no chunks yet/)).toBeTruthy())
  })
})
```

`test/chunk-detail.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { ChunkDetailPage } from "../src/pages/chunk-detail"
import { renderPage, scriptedClient } from "./harness"

const CHUNK = "chk_01k70000000000000000000111"
const DOC = "doc_01k70000000000000000000001"
const COL = "col_01k70000000000000000000001"

function detail(over: Record<string, unknown> = {}) {
  return {
    chunk: {
      id: CHUNK, document_id: DOC, collection_id: COL, tenant_id: "",
      content: "The money goes back to the card or account you paid with.\nIf you paid with a gift card, the refund arrives as store credit.",
      index: 1, start_offset: 160, end_offset: 352, token_count: 48,
      metadata: { section: "refunds", lang: "en" }, created_at: "2026-10-04T09:00:00Z",
    },
    document_title: "Refund policy",
    previous_id: "chk_01k70000000000000000000110",
    next_id: "chk_01k70000000000000000000112",
    ...over,
  }
}

describe("ChunkDetailPage", () => {
  it("reads the chunk it was opened for and shows its full text", async () => {
    const { client, queried } = scriptedClient({ "chunks.get": detail() })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByText(/arrives as store credit/)).toBeTruthy()
    expect(queried[0]).toEqual({ intent: "chunks.get", params: { id: CHUNK } })
  })

  it("names its document, its offsets and its token estimate", async () => {
    const { client } = scriptedClient({ "chunks.get": detail() })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect((await screen.findByRole("link", { name: "Refund policy" })).getAttribute("href")).toBe(`/documents/${DOC}`)
    expect(screen.getByText("160 to 352")).toBeTruthy()
    expect(screen.getByText(/about 48 tokens \(characters ÷ 4\)/)).toBeTruthy()
    expect(screen.getByText("section")).toBeTruthy()
  })

  it("links the chunks either side", async () => {
    const { client } = scriptedClient({ "chunks.get": detail() })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect((await screen.findByRole("link", { name: "Previous chunk" })).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000110")
    expect(screen.getByRole("link", { name: "Next chunk" }).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000112")
  })

  it("marks the first chunk as having none before it", async () => {
    const { client } = scriptedClient({ "chunks.get": detail({ previous_id: "" }) })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByLabelText("no previous chunk")).toBeTruthy()
  })

  it("opens a chunk whose document is gone, and says so rather than linking it", async () => {
    const { client } = scriptedClient({ "chunks.get": detail({ document_title: "" }) })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByText("document deleted")).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Refund policy" })).toBeNull()
    expect(screen.getByText(DOC).className).toContain("font-mono")
  })

  it("shows an error card for a chunk that doesn't exist", async () => {
    const { client } = scriptedClient({ "chunks.get": new ContractError("NOT_FOUND", "chunk not found") })
    renderPage(ChunkDetailPage, client, { id: CHUNK })
    expect(await screen.findByText(/chunk not found/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Chunks fifth in the RAG group and routes a chunk's page", () => {
    const nav = weavePlugin.nav?.find((n) => n.label === "Chunks")
    expect(nav?.to).toBe("/chunks")
    expect(nav?.priority).toBe(30)
    const paths = weavePlugin.routes.map((r) => r.path)
    expect(paths).toContain("/chunks")
    expect(paths).toContain("/chunks/:id")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write the chunks page**

`src/pages/chunks.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { FilterBar } from "@forge-go/dashboard-kit/components/filter-bar"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { IdLink } from "../components/id"
import { formatCount, plural } from "../format"
import { chunkPath, documentPath, useSearchParam, useSetSearchParams } from "../links"
import { PAGE_SIZE, offsetFor, pageOf } from "../paging"
import type { Chunk, Collection, ListOutput } from "../types"

const columns: Column<Chunk>[] = [
  { id: "id", header: "Chunk", cell: (c) => <IdLink to={chunkPath(c.id)} value={c.id} label={`Open chunk ${c.id}`} /> },
  { id: "document", header: "Document", cell: (c) => <IdLink to={documentPath(c.document_id)} value={c.document_id} label={`Open document ${c.document_id}`} /> },
  { id: "index", header: "Position", align: "end", cell: (c) => <span className="tabular-nums">{c.index}</span> },
  { id: "text", header: "Text", className: "font-medium", cell: (c) => <span className="line-clamp-2 font-medium">{c.content}</span> },
  { id: "tokens", header: "Tokens", align: "end", cell: (c) => <span className="tabular-nums">{formatCount(c.token_count)}</span> },
  {
    id: "bytes",
    header: "Bytes",
    cell: (c) => (
      <span className="font-mono text-xs tabular-nums">
        {c.start_offset} to {c.end_offset}
      </span>
    ),
  },
]

/**
 * A collection's chunks, by document and then by position. Weave refuses an
 * unscoped listing, so the page asks for a collection first.
 */
export const ChunksPage: ComponentType<PluginPageProps> = () => {
  const collectionId = useSearchParam("collection_id")
  const setParams = useSetSearchParams("/chunks")
  const [offset, setOffset] = useState(0)
  const collections = useQuery<ListOutput<Collection>>("collections.list", { limit: 100 })
  const chunks = useQuery<ListOutput<Chunk>>("chunks.list", { collection_id: collectionId, limit: PAGE_SIZE, offset }, { enabled: collectionId !== "" })

  const known = collections.data?.items ?? []
  const options = [
    { label: "Pick a collection", value: "" },
    ...known.map((c) => ({ label: c.name, value: c.id })),
    ...(collectionId !== "" && !known.some((c) => c.id === collectionId) ? [{ label: collectionId, value: collectionId }] : []),
  ]

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Chunks" description="What Weave stored for a collection, in reading order: by document, then by position." />
      <FilterBar
        filters={[
          {
            id: "collection",
            label: "Collection",
            value: collectionId,
            options,
            onChange: (v) => {
              setOffset(0)
              setParams({ collection_id: v })
            },
          },
        ]}
      />
      {collectionId === "" ? (
        <EmptyState title="Pick a collection" description="Chunks are listed one collection at a time, because a listing across every collection is a scan nobody needs." />
      ) : (
        <QueryBoundary title="Chunks" query={chunks} keepPreviousData>
          {(data) => (
            <ResourceTable<Chunk>
              columns={columns}
              rows={data.items}
              rowKey={(c) => c.id}
              caption={plural(data.total, "chunk", "chunks")}
              emptyMessage="This collection has no chunks yet. Ingest a document into it."
              pagination={pageOf(data)}
              onPageChange={(page) => setOffset(offsetFor(page, data.limit))}
            />
          )}
        </QueryBoundary>
      )}
    </section>
  )
}
```

The text column carries `font-medium` because the text is what an operator reads here. The query names its params in the same order the test expects (`collection_id`, `limit`, `offset`); `toEqual` does not care about key order, so that is for reading only.

- [ ] **Step 4: Write the chunk page**

`src/pages/chunk-detail.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { Id, IdLink } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { formatCount, isRealTime } from "../format"
import { chunkPath, collectionPath, documentPath } from "../links"
import type { ChunkDetail } from "../types"

export const ChunkDetailPage: ComponentType<PluginPageProps> = ({ params }) => {
  const id = params.id ?? ""
  const detail = useQuery<ChunkDetail>("chunks.get", { id })

  return (
    <QueryBoundary title="Chunk" query={detail} skeletonRows={6}>
      {({ chunk, document_title, previous_id, next_id }) => (
        <section className="flex flex-col gap-6">
          <PageHeader
            title={`Chunk ${chunk.index}`}
            description={document_title !== "" ? `Of ${document_title}` : "Its document has been deleted."}
          />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Text</h2>
            <p className="whitespace-pre-wrap rounded-md border p-3 text-sm">{chunk.content}</p>
          </section>
          <DescriptionList
            items={[
              { term: "ID", value: <Id value={chunk.id} /> },
              {
                term: "Document",
                value:
                  document_title !== "" ? (
                    <PluginLink to={documentPath(chunk.document_id)} className="underline-offset-4 hover:underline">
                      {document_title}
                    </PluginLink>
                  ) : (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">document deleted</span>
                      <Id value={chunk.document_id} />
                    </span>
                  ),
              },
              { term: "Collection", value: <IdLink to={collectionPath(chunk.collection_id)} value={chunk.collection_id} /> },
              { term: "Tenant", value: chunk.tenant_id !== "" ? <Id value={chunk.tenant_id} /> : <NoneCell label="tenant" /> },
              { term: "Position", value: <span className="tabular-nums">{chunk.index}</span> },
              {
                term: "Bytes",
                value: (
                  <span className="font-mono text-xs tabular-nums">
                    {chunk.start_offset} to {chunk.end_offset}
                  </span>
                ),
              },
              { term: "Tokens", value: `about ${formatCount(chunk.token_count)} tokens (characters ÷ 4)` },
              { term: "Created", value: isRealTime(chunk.created_at) ? <Timestamp value={chunk.created_at} label="creation date" /> : <NoneCell label="creation date" /> },
              ...(chunk.parent_id ? [{ term: "Parent", value: <Id value={chunk.parent_id} /> }] : []),
            ]}
          />
          <p className="text-xs text-muted-foreground">Byte offsets into the text after loading and trimming. The semantic and code chunkers only approximate them.</p>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Metadata</h2>
            <MetadataList metadata={chunk.metadata} />
          </section>
          <nav className="flex gap-6 text-sm" aria-label="Neighbouring chunks">
            {previous_id !== "" ? (
              <PluginLink to={chunkPath(previous_id)} className="underline">
                Previous chunk
              </PluginLink>
            ) : (
              <NoneCell label="previous chunk" />
            )}
            {next_id !== "" ? (
              <PluginLink to={chunkPath(next_id)} className="underline">
                Next chunk
              </PluginLink>
            ) : (
              <NoneCell label="next chunk" />
            )}
          </nav>
        </section>
      )}
    </QueryBoundary>
  )
}
```

- [ ] **Step 5: Register the pages**

In `src/index.tsx`, import `LayersIcon`, `ChunksPage` and `ChunkDetailPage`, export both pages, add `{ label: "Chunks", to: "/chunks", priority: 30, icon: <LayersIcon />, group: "RAG" }` to `nav`, and `{ path: "/chunks", element: ChunksPage }` and `{ path: "/chunks/:id", element: ChunkDetailPage }` to `routes`.

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/pages/chunks.tsx packages/plugin-weave/src/pages/chunk-detail.tsx packages/plugin-weave/test/chunks.test.tsx packages/plugin-weave/test/chunk-detail.test.tsx
git commit --only -m "feat(plugin-weave): add the chunks page and a chunk's page" -m "<body>" -- packages/plugin-weave/src/pages/chunks.tsx packages/plugin-weave/src/pages/chunk-detail.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/chunks.test.tsx packages/plugin-weave/test/chunk-detail.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: chunks are listed one collection at a time in reading order, and a chunk whose document was deleted still opens and says so instead of failing.

---
### Task 12: The retrieval model

**Files:**
- Create: `packages/plugin-weave/src/retrieval/model.ts`
- Test: `packages/plugin-weave/test/retrieval-model.test.ts`

**Interfaces:**
- Consumes: `Hit`, `CompareResult`, `AssembledContext`, `AssembleHit`, `Components` (types); `isReorderingRetriever` (Task 4).
- Produces (Task 13 imports every one):
  - `type HitState = "hydrated" | "orphaned" | "unidentified"`; `hitState(hit: Hit): HitState`
  - `chunkLinkOf(hit: Hit): string`: the chunk ID to link to, `""` when there is no chunk page to open
  - `documentOf(hit: Hit): { id: string; linkable: boolean }`
  - `type Movement = { kind: "same" | "up" | "down" | "outside"; by: number }`; `movement(hit: Hit): Movement`
  - `assembleHitsFrom(hits: Hit[]): AssembleHit[]`
  - `type Emptiness = { kind: "no-vectors" } | { kind: "all-filtered"; matches: number; best: number; minScore: number } | { kind: "none-returned"; matches: number }`; `emptiness(result: CompareResult, minScore: number): Emptiness | null`; `emptinessCopy(e: Emptiness): string`
  - `noReorderingCopy(result: CompareResult, components: Components | undefined): string | null`
  - `CONTEXT_HEADER`, `CONTEXT_SEPARATOR`; `type ContextPart = { kind: "text"; text: string } | { kind: "marker"; n: number }`; `contextParts(context: string): ContextPart[]`; `hitForMarker(context: AssembledContext, n: number): number`

These are pure, so every rule the page depends on is tested here without rendering anything.

- [ ] **Step 1: Write the failing tests**

`test/retrieval-model.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  assembleHitsFrom,
  chunkLinkOf,
  contextParts,
  documentOf,
  emptiness,
  emptinessCopy,
  hitForMarker,
  hitState,
  movement,
  noReorderingCopy,
} from "../src/retrieval/model"
import type { CompareResult, Components, Hit, HitChunk } from "../src/types"

const ZERO = "0001-01-01T00:00:00Z"

function chunk(over: Partial<HitChunk> = {}): HitChunk {
  return {
    id: "chk_01k70000000000000000000100", document_id: "doc_01k70000000000000000000001", collection_id: "col_01k70000000000000000000001",
    tenant_id: "", content: "Refunds take 14 days.", index: 0, start_offset: 0, end_offset: 21, token_count: 5,
    metadata: { document_id: "doc_01k70000000000000000000001" }, created_at: "2026-10-04T09:00:00Z", ...over,
  }
}

const hydrated: Hit = { chunk: chunk(), score: 0.83, hydrated: true, rank: 1, vector_rank: 1, vector_score: 0.83 }
const orphan: Hit = {
  chunk: chunk({ id: "chk_01k70000000000000000000901", document_id: "", collection_id: "", index: 0, start_offset: 0, end_offset: 0, token_count: 0, created_at: ZERO, metadata: { document_id: "doc_01k70000000000000000000099" } }),
  score: 0.79, hydrated: false, orphaned: true, rank: 2, vector_rank: 3, vector_score: 0.79,
}
const unidentified: Hit = { chunk: null, score: 0.7, hydrated: false, rank: 3, vector_rank: 0, vector_score: 0 }

function result(over: Partial<CompareResult> = {}): CompareResult {
  return {
    hits: [hydrated], left_out: [], window: 50, vector_matches: 23, best_vector_score: 0.861,
    reordered: false, same_search: false, score: "mmr_relevance", retriever_ms: 412, vector_ms: 120, ...over,
  }
}

function components(kind: string, configured = true): Components {
  return {
    loader: { kind: "text", configured: true }, chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true }, vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever: { kind, configured }, score: "cosine", tenant_filter: "verified",
  }
}

describe("hitState", () => {
  it("tells the three kinds of hit apart", () => {
    expect(hitState(hydrated)).toBe("hydrated")
    expect(hitState(orphan)).toBe("orphaned")
    expect(hitState(unidentified)).toBe("unidentified")
  })
})

describe("links", () => {
  it("links only a hydrated hit to its chunk", () => {
    expect(chunkLinkOf(hydrated)).toBe("chk_01k70000000000000000000100")
    expect(chunkLinkOf(orphan)).toBe("")
    expect(chunkLinkOf(unidentified)).toBe("")
  })

  it("reads an orphan's document from the vector metadata, and never links it", () => {
    expect(documentOf(hydrated)).toEqual({ id: "doc_01k70000000000000000000001", linkable: true })
    expect(documentOf(orphan)).toEqual({ id: "doc_01k70000000000000000000099", linkable: false })
    expect(documentOf(unidentified)).toEqual({ id: "", linkable: false })
  })
})

describe("movement", () => {
  it("compares the final rank with the vector rank", () => {
    expect(movement({ ...hydrated, rank: 2, vector_rank: 7 })).toEqual({ kind: "up", by: 5 })
    expect(movement({ ...hydrated, rank: 7, vector_rank: 4 })).toEqual({ kind: "down", by: 3 })
    expect(movement(hydrated)).toEqual({ kind: "same", by: 0 })
    expect(movement(unidentified)).toEqual({ kind: "outside", by: 0 })
  })
})

describe("assembleHitsFrom", () => {
  it("echoes every hit in order, and sends null content for a hit with no chunk", () => {
    expect(assembleHitsFrom([hydrated, orphan, unidentified])).toEqual([
      { chunk_id: "chk_01k70000000000000000000100", content: "Refunds take 14 days.", score: 0.83 },
      { chunk_id: "chk_01k70000000000000000000901", content: "Refunds take 14 days.", score: 0.79 },
      { chunk_id: "", content: null, score: 0.7 },
    ])
  })
})

describe("emptiness", () => {
  it("is null when there are hits", () => {
    expect(emptiness(result(), 0)).toBeNull()
  })

  it("says vector search found nothing", () => {
    const e = emptiness(result({ hits: [], vector_matches: 0, best_vector_score: 0 }), 0)
    expect(e).toEqual({ kind: "no-vectors" })
    expect(emptinessCopy(e!)).toMatch(/Vector search found nothing/)
  })

  it("blames the min score when the best match was under it", () => {
    const e = emptiness(result({ hits: [] }), 0.9)
    expect(emptinessCopy(e!)).toBe("Min score 0.9 removed all 23 vector matches; the best was 0.861.")
  })

  it("says the retriever returned none when the min score was not the cause", () => {
    const e = emptiness(result({ hits: [] }), 0)
    expect(emptinessCopy(e!)).toBe("Vector search found 23 matches and the retriever returned none of them.")
  })
})

describe("noReorderingCopy", () => {
  it("is null when something moved", () => {
    expect(noReorderingCopy(result({ reordered: true }), components("mmr"))).toBeNull()
  })

  it("speaks about the deployment when nothing could move", () => {
    const copy = "No reordering: this deployment returns the vector ranking as it is."
    expect(noReorderingCopy(result({ same_search: true }), components("", false))).toBe(copy)
    expect(noReorderingCopy(result(), components("similarity"))).toBe(copy)
  })

  it("speaks about the query when a reordering retriever happened not to move anything", () => {
    expect(noReorderingCopy(result(), components("mmr"))).toBe("No reordering for this query: it came back in vector order. The next query may not.")
  })
})

describe("contextParts", () => {
  it("splits Weave's context into its header, markers and text", () => {
    const parts = contextParts("Relevant context:\n\n[1] Refunds take 14 days.\n\n---\n\n[2] Express arrives tomorrow.")
    expect(parts).toEqual([
      { kind: "text", text: "Relevant context:\n\n" },
      { kind: "marker", n: 1 },
      { kind: "text", text: "Refunds take 14 days." },
      { kind: "text", text: "\n\n---\n\n" },
      { kind: "marker", n: 2 },
      { kind: "text", text: "Express arrives tomorrow." },
    ])
  })

  it("leaves a [n] inside a chunk's own text alone", () => {
    expect(contextParts("[1] See note [3] below.")).toEqual([{ kind: "marker", n: 1 }, { kind: "text", text: "See note [3] below." }])
  })

  it("keeps the header alone when nothing fit, and has no parts for an empty string", () => {
    expect(contextParts("Relevant context:\n\n")).toEqual([{ kind: "text", text: "Relevant context:\n\n" }])
    expect(contextParts("")).toEqual([])
  })
})

describe("hitForMarker", () => {
  it("maps marker n to included[n-1], which is not a prefix", () => {
    const context = { context: "", total_tokens: 0, max_tokens: 4096, included: [0, 2, 4], first_excluded: 1, token_counter: "chars/4" }
    expect(hitForMarker(context, 2)).toBe(2)
    expect(hitForMarker(context, 3)).toBe(4)
    expect(hitForMarker(context, 9)).toBe(-1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/retrieval/model.ts`**

```ts
import { isReorderingRetriever } from "../score"
import type { AssembleHit, AssembledContext, CompareResult, Components, Hit } from "../types"

export type HitState = "hydrated" | "orphaned" | "unidentified"

/**
 * Hydrated is the normal hit. Orphaned: the vector store returned a chunk ID
 * with no row behind it. Unidentified: a custom retriever set no chunk ID, or
 * returned no chunk at all. Both odd kinds keep their rank on the page.
 */
export function hitState(hit: Hit): HitState {
  if (hit.hydrated) return "hydrated"
  return hit.orphaned ? "orphaned" : "unidentified"
}

/** The chunk page to open, or "" when there isn't one. An orphan's ID names a row that doesn't exist. */
export function chunkLinkOf(hit: Hit): string {
  return hit.hydrated && hit.chunk && hit.chunk.id !== "" ? hit.chunk.id : ""
}

/**
 * The document a hit came from. A hydrated hit has the row's own field. An
 * orphan has only the vector store's metadata key, which may name a document
 * that is gone, so it is shown and never linked.
 */
export function documentOf(hit: Hit): { id: string; linkable: boolean } {
  if (!hit.chunk) return { id: "", linkable: false }
  if (hit.hydrated && hit.chunk.document_id !== "") return { id: hit.chunk.document_id, linkable: true }
  return { id: hit.chunk.metadata?.document_id ?? "", linkable: false }
}

export interface Movement {
  kind: "same" | "up" | "down" | "outside"
  by: number
}

/** How far the retriever moved a hit from its place in the raw vector ranking. */
export function movement(hit: Hit): Movement {
  if (hit.vector_rank === 0) return { kind: "outside", by: 0 }
  const delta = hit.vector_rank - hit.rank
  if (delta > 0) return { kind: "up", by: delta }
  if (delta < 0) return { kind: "down", by: -delta }
  return { kind: "same", by: 0 }
}

/**
 * The run's hits as retrieval.assemble takes them, in the run's order. A hit
 * with no chunk sends content null, so re-assembly skips it as the run did;
 * "" would add an empty [n] and shift every marker after it.
 */
export function assembleHitsFrom(hits: Hit[]): AssembleHit[] {
  return hits.map((h) => ({ chunk_id: h.chunk?.id ?? "", content: h.chunk ? h.chunk.content : null, score: h.score }))
}

export type Emptiness =
  | { kind: "no-vectors" }
  | { kind: "all-filtered"; matches: number; best: number; minScore: number }
  | { kind: "none-returned"; matches: number }

/** Which kind of empty a run is, or null when it has hits. */
export function emptiness(result: CompareResult, minScore: number): Emptiness | null {
  if (result.hits.length > 0) return null
  if (result.vector_matches === 0) return { kind: "no-vectors" }
  if (minScore > 0 && result.best_vector_score < minScore) {
    return { kind: "all-filtered", matches: result.vector_matches, best: result.best_vector_score, minScore }
  }
  return { kind: "none-returned", matches: result.vector_matches }
}

export function emptinessCopy(e: Emptiness): string {
  switch (e.kind) {
    case "no-vectors":
      return "Vector search found nothing. This collection has no vectors yet, or the tenant filter excludes every one."
    case "all-filtered":
      return `Min score ${e.minScore} removed all ${e.matches} vector matches; the best was ${e.best.toFixed(3)}.`
    case "none-returned":
      return `Vector search found ${e.matches} matches and the retriever returned none of them.`
  }
}

/**
 * What to say when the final ranking is the vector ranking. If nothing could
 * have moved (no retriever, or plain similarity), it is a fact about the
 * deployment. If a reordering retriever happened to keep vector order, it is
 * a fact about this query only.
 */
export function noReorderingCopy(result: CompareResult, components: Components | undefined): string | null {
  if (result.reordered) return null
  if (result.same_search || (components !== undefined && !isReorderingRetriever(components))) {
    return "No reordering: this deployment returns the vector ranking as it is."
  }
  return "No reordering for this query: it came back in vector order. The next query may not."
}

/**
 * Weave's default template (assembler/template.go) writes this header first,
 * every time, even when nothing fit, then joins "[n] content" blocks with the
 * separator. The header's bytes are not in total_tokens.
 */
export const CONTEXT_HEADER = "Relevant context:\n\n"
export const CONTEXT_SEPARATOR = "\n\n---\n\n"

export type ContextPart = { kind: "text"; text: string } | { kind: "marker"; n: number }

/**
 * The assembled context as text and markers. A marker is "[n] " at the start
 * of a block, never a "[n]" inside a chunk's own text. The default header is
 * its own text part, so the first block's marker is still found.
 */
export function contextParts(context: string): ContextPart[] {
  if (context === "") return []
  const out: ContextPart[] = []
  let body = context
  if (body.startsWith(CONTEXT_HEADER)) {
    out.push({ kind: "text", text: CONTEXT_HEADER })
    body = body.slice(CONTEXT_HEADER.length)
    if (body === "") return out
  }
  body.split(CONTEXT_SEPARATOR).forEach((block, i) => {
    if (i > 0) out.push({ kind: "text", text: CONTEXT_SEPARATOR })
    const m = /^\[(\d+)\] /.exec(block)
    if (m) {
      out.push({ kind: "marker", n: Number(m[1]) })
      out.push({ kind: "text", text: block.slice(m[0].length) })
    } else {
      out.push({ kind: "text", text: block })
    }
  })
  return out
}

/** Marker [n] is hit included[n-1]. -1 when the marker names nothing. */
export function hitForMarker(context: AssembledContext, n: number): number {
  return context.included[n - 1] ?? -1
}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/retrieval/model.ts packages/plugin-weave/test/retrieval-model.test.ts
git commit --only -m "feat(plugin-weave): model a retrieval run's hits, emptiness and context" -m "<body>" -- packages/plugin-weave/src/retrieval/model.ts packages/plugin-weave/test/retrieval-model.test.ts
git show --stat HEAD
```

Body, for example: the rules the retrieval page leans on live here and are tested on their own: the three kinds of hit, the three kinds of empty, which "no reordering" sentence is true, and that a hit with no chunk is echoed with null content so re-assembly keeps the markers in place.

---

### Task 13: Retrieval page

**Files:**
- Create: `packages/plugin-weave/src/use-wide.ts`, `src/retrieval/ranking-table.tsx`, `src/retrieval/inspector.tsx`, `src/retrieval/context-view.tsx`, `src/pages/retrieval.tsx`
- Modify: `packages/plugin-weave/src/index.tsx`
- Test: `packages/plugin-weave/test/retrieval.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: everything in `src/retrieval/model.ts` (Task 12); `scoreHeader(kind, vectorScore?)`, `retrieverSentence` (Task 4; MMR and similarity scores are labelled by the vector store's score kind, so pass `components?.vector_store.score`); `MetadataList`, `Id`, `TenantFilter`, `withTenant`, `chunkPath`, `documentPath`, `formatScore`, `formatMs`, `formatCount`, `plural`, `isRealTime`, `utf8Length` (Task 1); types `RunOutput`, `AssembledContext`, `Hit`, `ComponentsOutput`, `Collection`, `ListOutput`.
- Produces: `RetrievalPage`; `useWide()`; `RankingTable`, `Inspector`, `ContextView`.

The page someone opens when an answer was bad. The spec's "Retrieval" section is the design and this task builds exactly it: a form, a one-paragraph summary, three tabs (Ranking, Context sent to the model, Left out), an inspector beside the ranking on wide screens and in a sheet on narrow ones, and three kinds of empty. Read that section and the slice 1 hand-off's "Behaviours that differ from the plan" before you start.

- [ ] **Step 1: Write the failing tests**

`test/retrieval.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { RetrievalPage } from "../src/pages/retrieval"
import { pendingClient, renderPage, scriptedClient } from "./harness"
import type { RunOutput } from "../src/types"

const ZERO = "0001-01-01T00:00:00Z"
const COL = "col_01k70000000000000000000001"
const DOC_A = "doc_01k70000000000000000000001"
const DOC_B = "doc_01k70000000000000000000002"
const GONE = "doc_01k70000000000000000000099"

function chunk(id: string, document_id: string, index: number, content: string, extra: Record<string, unknown> = {}) {
  return {
    id, document_id, collection_id: COL, tenant_id: "", content, index,
    start_offset: index * 160, end_offset: index * 160 + 192, token_count: 48,
    metadata: { document_id, chunk_index: String(index) }, created_at: "2026-10-04T09:00:00Z", ...extra,
  }
}

const RUN: RunOutput = {
  result: {
    hits: [
      { chunk: chunk("chk_01k70000000000000000000100", DOC_A, 0, "Refunds are issued within 14 days of the return reaching our warehouse."), score: 0.8312, hydrated: true, rank: 1, vector_rank: 1, vector_score: 0.8312 },
      { chunk: chunk("chk_01k70000000000000000000120", DOC_B, 3, "If the order shipped in more than one parcel, each parcel is refunded on its own."), score: 0.802, hydrated: true, rank: 2, vector_rank: 7, vector_score: 0.802 },
      {
        chunk: chunk("chk_01k70000000000000000000901", "", 0, "Gift card refunds are paid as store credit within 14 days.", {
          collection_id: "", start_offset: 0, end_offset: 0, token_count: 0, created_at: ZERO, metadata: { document_id: GONE },
        }),
        score: 0.79, hydrated: false, orphaned: true, rank: 3, vector_rank: 2, vector_score: 0.79,
      },
      { chunk: null, score: 0.7, hydrated: false, rank: 4, vector_rank: 0, vector_score: 0 },
      { chunk: chunk("chk_01k70000000000000000000103", DOC_A, 3, "We email you when the refund is issued."), score: 0.744, hydrated: true, rank: 5, vector_rank: 4, vector_score: 0.744 },
    ],
    left_out: [
      { chunk: chunk("chk_01k70000000000000000000101", DOC_A, 1, "The money goes back to the card you paid with."), score: 0.8, hydrated: true, rank: 0, vector_rank: 3, vector_score: 0.8 },
    ],
    window: 50,
    vector_matches: 23,
    best_vector_score: 0.8312,
    reordered: true,
    same_search: false,
    score: "mmr_relevance",
    retriever_ms: 412.4,
    vector_ms: 120.2,
  },
  context: {
    context:
      "Relevant context:\n\n[1] Refunds are issued within 14 days of the return reaching our warehouse.\n\n---\n\n[2] If the order shipped in more than one parcel, each parcel is refunded on its own.\n\n---\n\n[3] Gift card refunds are paid as store credit within 14 days.",
    total_tokens: 3980,
    max_tokens: 4096,
    included: [0, 1, 2],
    first_excluded: 3,
    token_counter: "chars/4",
  },
}

const COMPONENTS = {
  components: {
    loader: { kind: "text", configured: true },
    chunker: { kind: "recursive", configured: true },
    embedder: { kind: "openai", configured: true },
    vector_store: { kind: "memory", score: "cosine", configured: true },
    retriever: { kind: "mmr", score: "mmr_relevance", params: { lambda: "0.70" }, configured: true },
    score: "mmr_relevance",
    tenant_filter: "verified",
  },
  config: { default_chunk_size: 512, default_chunk_overlap: 50, default_embedding_model: "m", default_chunk_strategy: "recursive", default_top_k: 10, shutdown_timeout_seconds: 30 },
  extensions: [],
}

const COLLECTIONS = { items: [{ id: COL, name: "support-articles", tenant_id: "", metadata: {} }], total: 1, limit: 100, offset: 0 }

function queries(components: unknown = COMPONENTS) {
  return { "system.components": components, "collections.list": COLLECTIONS }
}

async function ask(query = "how long do refunds take") {
  fireEvent.change(await screen.findByLabelText("Query"), { target: { value: query } })
  fireEvent.click(screen.getByRole("button", { name: "Run query" }))
}

function row(rank: number): HTMLElement {
  return screen.getAllByRole("row").find((r) => r.getAttribute("data-rank") === String(rank))!
}

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("RetrievalPage", () => {
  it("invites a question and runs nothing until asked", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    expect(await screen.findByText("Ask Weave a question")).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("sends the query with zeros for the defaults, and nothing it wasn't given", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    await waitFor(() => expect(sent).toEqual([{ intent: "retrieval.run", payload: { query: "how long do refunds take", top_k: 0, min_score: 0, max_tokens: 0 } }]))
  })

  it("adds a collection and a tenant only when they are picked", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await screen.findByRole("option", { name: "support-articles" })
    fireEvent.change(screen.getByLabelText("Collection"), { target: { value: COL } })
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "none" } })
    await ask()
    await waitFor(() => expect(sent[0]?.payload).toEqual({ query: "how long do refunds take", collection_id: COL, tenant: "", top_k: 0, min_score: 0, max_tokens: 0 }))
  })

  it("never puts the query in the address", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask("customer 4411 asked about a refund")
    await screen.findByText(/hits in/)
    expect(window.location.href).not.toMatch(/4411|refund/)
  })

  it("names the retriever from the component report and times both sides", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    expect(await screen.findByText(/MMR retriever \(λ 0.70\)/)).toBeTruthy()
    expect(screen.getByText(/5 hits in 412 ms\. Vector search returned 23 of a 50 window in 120 ms\./)).toBeTruthy()
  })

  it("ranks hits with the score named for its kind, three decimals and movement", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    await screen.findByText(/hits in/)
    expect(screen.getByRole("columnheader", { name: "Cosine" })).toBeTruthy()
    expect(within(row(1)).getByText("0.831").className).toContain("tabular-nums")
    expect(within(row(2)).getByText("↑5")).toBeTruthy()
    expect(within(row(3)).getByText("↓1")).toBeTruthy()
    expect(within(row(4)).getByLabelText("no place in the vector window")).toBeTruthy()
  })

  it("keeps orphaned and unidentified hits at their rank and says what they are", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    await screen.findByText(/hits in/)
    expect(within(row(3)).getByText("no chunk row")).toBeTruthy()
    expect(within(row(4)).getByText("no chunk")).toBeTruthy()
  })

  it("draws the budget line above the first hit that didn't make it, and dims what fell off", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    const line = await screen.findByText(/Context budget 4,096 tokens: 3 hits, 3,980 used/)
    const rows = screen.getAllByRole("row")
    const lineRow = line.closest("tr")!
    expect(rows.indexOf(lineRow)).toBe(rows.indexOf(row(4)) - 1)
    expect(row(5).getAttribute("data-in-context")).toBe("false")
    expect(within(row(5)).getByText("retrieved, over budget")).toBeTruthy()
    expect(row(1).getAttribute("data-in-context")).toBe("true")
  })

  it("inspects a hit with its full text, links, offsets and metadata", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hit 2" }))
    const inspector = screen.getByRole("region", { name: "Hit 2" })
    expect(within(inspector).getByText(/each parcel is refunded on its own/)).toBeTruthy()
    expect(within(inspector).getByRole("link", { name: "Open the chunk" }).getAttribute("href")).toBe("/chunks/chk_01k70000000000000000000120")
    expect(within(inspector).getByRole("link", { name: "Open the document" }).getAttribute("href")).toBe(`/documents/${DOC_B}`)
    expect(within(inspector).getByText("480 to 672")).toBeTruthy()
    expect(within(inspector).getByText("chunk_index")).toBeTruthy()
  })

  it("shows an orphaned hit without a date or a broken link", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("button", { name: "Inspect hit 3" }))
    const inspector = screen.getByRole("region", { name: "Hit 3" })
    expect(within(inspector).getByText(/has no row for it/)).toBeTruthy()
    expect(within(inspector).queryByRole("link", { name: "Open the chunk" })).toBeNull()
    expect(within(inspector).queryByRole("link", { name: "Open the document" })).toBeNull()
    expect(within(inspector).getByText(GONE).className).toContain("font-mono")
    expect(within(inspector).getByLabelText("no creation date")).toBeTruthy()
    expect(within(inspector).queryByText(/0001-01-01|Jan 1, 1\b/)).toBeNull()
    for (const link of within(inspector).queryAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/\/documents\/$|\/chunks\/$/)
  })

  it("shows the context exactly as built, and a marker takes you to its hit", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: "Context sent to the model" }))
    expect(await screen.findByText(/Built by Weave's default assembler/)).toBeTruthy()
    expect(screen.getByText(/each parcel is refunded on its own/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Show hit 2" }))
    expect(await screen.findByRole("region", { name: "Hit 2" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Ranking" }).getAttribute("aria-selected")).toBe("true")
  })

  it("re-assembles with the run's hits, null content included, and a new budget", async () => {
    const smaller = { ...RUN.context, context: "Relevant context:\n\n[1] Refunds are issued within 14 days of the return reaching our warehouse.", total_tokens: 1800, max_tokens: 2000, included: [0], first_excluded: 1 }
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN, "retrieval.assemble": smaller })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: "Context sent to the model" }))
    fireEvent.change(await screen.findByLabelText("Token budget"), { target: { value: "2000" } })
    fireEvent.click(screen.getByRole("button", { name: "Re-assemble" }))
    await waitFor(() => expect(sent.at(-1)?.intent).toBe("retrieval.assemble"))
    const payload = sent.at(-1)?.payload as { hits: { chunk_id: string; content: string | null }[]; max_tokens: number }
    expect(payload.max_tokens).toBe(2000)
    expect(payload.hits).toHaveLength(5)
    expect(payload.hits[3]).toEqual({ chunk_id: "", content: null, score: 0.7 })
    expect(await screen.findByText(/1,800 of 2,000 tokens used/)).toBeTruthy()
  })

  it("lists strong matches the retriever left out, scored as vector scores", async () => {
    const { client } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: /Left out/ }))
    expect(await screen.findByRole("columnheader", { name: "Vector score" })).toBeTruthy()
    expect(screen.getByText(/back to the card you paid with/)).toBeTruthy()
  })

  it("says the deployment can't reorder when there is no retriever", async () => {
    const noRetriever = { ...COMPONENTS, components: { ...COMPONENTS.components, retriever: { kind: "", configured: false } } }
    const same = { ...RUN, result: { ...RUN.result, left_out: [], reordered: false, same_search: true } }
    const { client } = scriptedClient(queries(noRetriever), { "retrieval.run": same })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: /Left out/ }))
    expect(await screen.findByText("No reordering: this deployment returns the vector ranking as it is.")).toBeTruthy()
  })

  it("says only this query came back in vector order under MMR", async () => {
    const still = { ...RUN, result: { ...RUN.result, left_out: [], reordered: false } }
    const { client } = scriptedClient(queries(), { "retrieval.run": still })
    renderPage(RetrievalPage, client)
    await ask()
    fireEvent.click(await screen.findByRole("tab", { name: /Left out/ }))
    expect(await screen.findByText(/No reordering for this query/)).toBeTruthy()
  })

  it("says vector search found nothing", async () => {
    const none = { ...RUN, result: { ...RUN.result, hits: [], left_out: [], vector_matches: 0, best_vector_score: 0 }, context: { ...RUN.context, context: "Relevant context:\n\n", included: [], first_excluded: -1, total_tokens: 0 } }
    const { client } = scriptedClient(queries(), { "retrieval.run": none })
    renderPage(RetrievalPage, client)
    await ask()
    expect(await screen.findByText(/Vector search found nothing/)).toBeTruthy()
  })

  it("blames the min score when it removed every match", async () => {
    const none = { ...RUN, result: { ...RUN.result, hits: [], left_out: [] }, context: { ...RUN.context, context: "Relevant context:\n\n", included: [], first_excluded: -1, total_tokens: 0 } }
    const { client } = scriptedClient(queries(), { "retrieval.run": none })
    renderPage(RetrievalPage, client)
    fireEvent.change(await screen.findByLabelText("Min score"), { target: { value: "0.9" } })
    await ask()
    expect(await screen.findByText("Min score 0.9 removed all 23 vector matches; the best was 0.831.")).toBeTruthy()
  })

  it("shows the server's message for a missing embedder", async () => {
    const message = "retrieval needs Weave's own embedder and vector store; this deployment has no embedder configured"
    const { client } = scriptedClient(queries(), { "retrieval.run": new ContractError("UNAVAILABLE", message) })
    renderPage(RetrievalPage, client)
    await ask()
    expect(await screen.findByText(message)).toBeTruthy()
  })

  it("keeps the last result on screen when the next run fails", async () => {
    let calls = 0
    const { client } = scriptedClient(queries(), {
      "retrieval.run": () => (calls++ === 0 ? RUN : new ContractError("INTERNAL", "an internal error occurred")),
    })
    renderPage(RetrievalPage, client)
    await ask()
    await screen.findByText(/hits in/)
    await ask("a second question")
    expect(await screen.findByText("an internal error occurred")).toBeTruthy()
    expect(within(row(1)).getByText("0.831")).toBeTruthy()
  })

  it("disables Run while a run is in flight", async () => {
    renderPage(RetrievalPage, pendingClient())
    await ask()
    const button = await screen.findByRole("button", { name: "Running…" })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it("refuses a query over 8 KiB before sending it", async () => {
    const { client, sent } = scriptedClient(queries(), { "retrieval.run": RUN })
    renderPage(RetrievalPage, client)
    fireEvent.change(await screen.findByLabelText("Query"), { target: { value: "é".repeat(4097) } })
    expect(screen.getByText(/Queries are capped at 8 KiB/)).toBeTruthy()
    expect((screen.getByRole("button", { name: "Run query" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Retrieval second in the RAG group", () => {
    const nav = weavePlugin.nav?.find((n) => n.label === "Retrieval")
    expect(nav?.to).toBe("/retrieval")
    expect(nav?.priority).toBe(0)
    expect(weavePlugin.routes.map((r) => r.path)).toContain("/retrieval")
  })

  it("lists the nav in the spec's order", () => {
    const order = [...(weavePlugin.nav ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)).map((n) => n.label)
    expect(order).toEqual(["Overview", "Retrieval", "Collections", "Documents", "Chunks", "Pipeline"])
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/use-wide.ts`**

```ts
import { useSyncExternalStore } from "react"

const QUERY = "(min-width: 1024px)"

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {}
  const media = window.matchMedia(QUERY)
  media.addEventListener("change", onChange)
  return () => media.removeEventListener("change", onChange)
}

/**
 * Whether the inspector fits beside the ranking. Where the browser can't say
 * (jsdom has no matchMedia), it answers wide, so the inspector renders inline.
 */
export function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : true),
    () => true,
  )
}
```

- [ ] **Step 4: Write the ranking table**

`src/retrieval/ranking-table.tsx`:

```tsx
import { Fragment } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@forge-go/dashboard-kit/components/table"
import { cn } from "@forge-go/dashboard-kit/lib/utils"
import { Id } from "../components/id"
import { formatCount, formatScore, plural } from "../format"
import { documentPath } from "../links"
import type { AssembledContext, Hit } from "../types"
import { documentOf, hitState, movement } from "./model"

export function MovementCell({ hit }: { hit: Hit }) {
  const m = movement(hit)
  if (m.kind === "outside") return <NoneCell label="place in the vector window" />
  return (
    <span className="inline-flex items-center gap-2 tabular-nums">
      <span>{hit.vector_rank}</span>
      {m.kind === "up" ? <span className="text-xs text-muted-foreground" aria-label={`up ${m.by} from the vector ranking`}>↑{m.by}</span> : null}
      {m.kind === "down" ? <span className="text-xs text-muted-foreground" aria-label={`down ${m.by} from the vector ranking`}>↓{m.by}</span> : null}
    </span>
  )
}

export function HitStateBadge({ hit }: { hit: Hit }) {
  const state = hitState(hit)
  if (state === "orphaned") return <Badge variant="destructive">no chunk row</Badge>
  if (state === "unidentified" && hit.chunk) return <Badge variant="secondary">no chunk ID</Badge>
  return null
}

export function SourceCell({ hit }: { hit: Hit }) {
  const doc = documentOf(hit)
  if (doc.id === "") return <NoneCell label="source" />
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {doc.linkable ? (
        <PluginLink to={documentPath(doc.id)} className="font-mono text-xs underline-offset-4 hover:underline">
          {doc.id}
        </PluginLink>
      ) : (
        <Id value={doc.id} />
      )}
      {hit.hydrated && hit.chunk ? <span className="text-xs text-muted-foreground">#{hit.chunk.index}</span> : null}
    </span>
  )
}

/**
 * The final ranking, one row per hit, with the context budget as a full-width
 * row above the first hit that didn't make it in. Assembly skips a hit that
 * doesn't fit and carries on, so rows below the line can still be in the
 * context; each row is dimmed by `included`, not by its position.
 */
export function RankingTable({
  hits,
  context,
  scoreLabel,
  selected,
  onSelect,
}: {
  hits: Hit[]
  context: AssembledContext
  scoreLabel: string
  selected: number
  onSelect: (index: number) => void
}) {
  const included = new Set(context.included)
  return (
    <Table>
      <TableCaption>
        {plural(hits.length, "hit", "hits")}, {formatCount(context.included.length)} in the context
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>#</TableHead>
          <TableHead>{scoreLabel}</TableHead>
          <TableHead>Vector rank</TableHead>
          <TableHead>Chunk</TableHead>
          <TableHead>Source</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hits.map((hit, i) => (
          <Fragment key={`${hit.rank}-${hit.chunk?.id ?? i}`}>
            {i === context.first_excluded ? (
              <TableRow>
                <TableCell colSpan={5} className="border-y-2 border-dashed text-xs text-muted-foreground">
                  Context budget {formatCount(context.max_tokens)} tokens: {plural(context.included.length, "hit", "hits")},{" "}
                  {formatCount(context.total_tokens)} used. Dimmed rows below were retrieved and not sent.
                </TableCell>
              </TableRow>
            ) : null}
            <TableRow
              data-rank={hit.rank}
              data-in-context={included.has(i) ? "true" : "false"}
              aria-selected={selected === i}
              className={cn(selected === i && "bg-muted", !included.has(i) && "opacity-60")}
            >
              <TableCell className="tabular-nums">{hit.rank}</TableCell>
              <TableCell>
                <span className="font-mono text-xs tabular-nums">{formatScore(hit.score)}</span>
              </TableCell>
              <TableCell>
                <MovementCell hit={hit} />
              </TableCell>
              <TableCell className="max-w-xl">
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-1 text-left"
                  aria-label={`Inspect hit ${hit.rank}`}
                  onClick={() => onSelect(i)}
                >
                  {hit.chunk ? <span className="line-clamp-2 text-sm">{hit.chunk.content}</span> : <span className="text-sm text-muted-foreground">no chunk</span>}
                  <span className="flex flex-wrap gap-1">
                    <HitStateBadge hit={hit} />
                    {!included.has(i) && hit.chunk ? <span className="text-xs text-muted-foreground">retrieved, over budget</span> : null}
                  </span>
                </button>
              </TableCell>
              <TableCell>
                <SourceCell hit={hit} />
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </Table>
  )
}
```

The score cell's text is the element with `tabular-nums`, which is what the test reads. The kit's `Table` renders a `<table>` (check `packages/kit/src/components/table.tsx`); rows are `role="row"` without extra markup.

- [ ] **Step 5: Write the inspector**

`src/retrieval/inspector.tsx`:

```tsx
import { PluginLink } from "@forge-go/dashboard-plugin"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { Id } from "../components/id"
import { MetadataList } from "../components/metadata-list"
import { formatCount, formatScore, isRealTime } from "../format"
import { chunkPath, documentPath } from "../links"
import type { Hit } from "../types"
import { chunkLinkOf, documentOf, hitState } from "./model"
import { HitStateBadge, MovementCell } from "./ranking-table"

const STATE_NOTE = {
  orphaned:
    "The vector store returned this chunk ID, but Weave has no row for it. It keeps its rank because a model would still be handed its text.",
  unidentified: "The retriever returned this hit without a chunk ID, so Weave can't look it up.",
}

/** Everything about one hit. An odd hit shows what it has and nothing it doesn't. */
export function Inspector({ hit, label }: { hit: Hit; label: string }) {
  const state = hitState(hit)
  const chunkId = chunkLinkOf(hit)
  const doc = documentOf(hit)
  const hydrated = state === "hydrated" && hit.chunk !== null

  return (
    <section aria-label={label} className="flex flex-col gap-3 text-sm">
      <h3 className="font-medium">{label}</h3>
      <HitStateBadge hit={hit} />
      {state !== "hydrated" ? <p className="text-muted-foreground">{STATE_NOTE[state]}</p> : null}
      {hit.chunk ? (
        <p className="whitespace-pre-wrap rounded-md border p-2">{hit.chunk.content}</p>
      ) : (
        <p className="text-muted-foreground">This hit has no chunk, so it has no text and nothing went into the context for it.</p>
      )}
      <div className="flex flex-wrap gap-4">
        {chunkId !== "" ? (
          <PluginLink to={chunkPath(chunkId)} className="underline">
            Open the chunk
          </PluginLink>
        ) : null}
        {doc.linkable ? (
          <PluginLink to={documentPath(doc.id)} className="underline">
            Open the document
          </PluginLink>
        ) : null}
      </div>
      <DescriptionList
        items={[
          { term: "Score", value: <span className="font-mono text-xs tabular-nums">{formatScore(hit.score)}</span> },
          { term: "Vector rank", value: <MovementCell hit={hit} /> },
          {
            term: "Vector score",
            value: hit.vector_rank > 0 ? <span className="font-mono text-xs tabular-nums">{formatScore(hit.vector_score)}</span> : <NoneCell label="vector score" />,
          },
          { term: "Chunk ID", value: hit.chunk && hit.chunk.id !== "" ? <Id value={hit.chunk.id} /> : <NoneCell label="chunk ID" /> },
          { term: "Document", value: doc.id !== "" ? <Id value={doc.id} /> : <NoneCell label="document" /> },
          {
            term: "Bytes",
            value: hydrated ? (
              <span className="font-mono text-xs tabular-nums">
                {hit.chunk!.start_offset} to {hit.chunk!.end_offset}
              </span>
            ) : (
              <NoneCell label="offsets" />
            ),
          },
          { term: "Tokens", value: hydrated ? `about ${formatCount(hit.chunk!.token_count)}` : <NoneCell label="token estimate" /> },
          {
            term: "Created",
            value: hit.chunk && isRealTime(hit.chunk.created_at) ? <Timestamp value={hit.chunk.created_at} label="creation date" /> : <NoneCell label="creation date" />,
          },
        ]}
      />
      <div className="flex flex-col gap-1">
        <span className="font-medium">Metadata</span>
        <MetadataList metadata={hit.chunk?.metadata} />
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Write the context view**

`src/retrieval/context-view.tsx`:

```tsx
import { useState } from "react"
import { useCommand } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { formatCount, plural } from "../format"
import type { AssembledContext, Hit } from "../types"
import { assembleHitsFrom, contextParts, hitForMarker } from "./model"

/**
 * The assembled text exactly as built, read-only. Each [n] marker is a button
 * back to its hit. Re-assemble sends the run's own hits with a new budget,
 * so it embeds nothing and reads no store.
 */
export function ContextView({
  hits,
  context,
  onContext,
  onMarker,
}: {
  hits: Hit[]
  context: AssembledContext
  onContext: (next: AssembledContext) => void
  onMarker: (hitIndex: number) => void
}) {
  const assemble = useCommand<AssembledContext>("retrieval.assemble")
  const [budget, setBudget] = useState(String(context.max_tokens))
  const parsed = /^\d+$/.test(budget.trim()) ? Number(budget.trim()) : Number.NaN

  async function reassemble() {
    if (Number.isNaN(parsed)) return
    const answer = await assemble.execute({ hits: assembleHitsFrom(hits), max_tokens: parsed })
    if (answer !== undefined) onContext(answer)
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Built by Weave's default assembler (token counts are estimates: characters ÷ 4). Your app may assemble its own way.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="context-budget">Token budget</Label>
          <Input id="context-budget" inputMode="numeric" className="w-32 font-mono" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </div>
        <Button type="button" variant="outline" disabled={assemble.loading || Number.isNaN(parsed)} onClick={() => void reassemble()}>
          {assemble.loading ? "Re-assembling…" : "Re-assemble"}
        </Button>
        <span className="text-sm tabular-nums">
          {formatCount(context.total_tokens)} of {formatCount(context.max_tokens)} tokens used, {plural(context.included.length, "hit", "hits")} of{" "}
          {formatCount(hits.length)}
        </span>
      </div>
      <CommandAlert title="Could not re-assemble" error={assemble.error} />
      {context.included.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing fit in the budget, so a model would get only the template's header.</p>
      ) : (
        <pre className="whitespace-pre-wrap rounded-md border p-3 text-sm">
          {contextParts(context.context).map((part, i) =>
            part.kind === "marker" ? (
              <button
                key={i}
                type="button"
                className="font-mono text-xs underline"
                aria-label={`Show hit ${hitForMarker(context, part.n) + 1}`}
                onClick={() => {
                  const target = hitForMarker(context, part.n)
                  if (target >= 0) onMarker(target)
                }}
              >
                [{part.n}]
              </button>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </pre>
      )}
    </div>
  )
}
```

The marker's accessible name is the hit's rank, `Show hit <rank>`; for the test's run, marker [2] is `included[1]` = hit index 1, rank 2. Rank and position are the same here (`rank` is `index + 1` for final hits).

- [ ] **Step 7: Write the page**

`src/pages/retrieval.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@forge-go/dashboard-kit/components/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@forge-go/dashboard-kit/components/tabs"
import { TenantFilter } from "../components/tenant-filter"
import { formatMs, formatScore, plural, utf8Length } from "../format"
import { ContextView } from "../retrieval/context-view"
import { Inspector } from "../retrieval/inspector"
import { emptiness, emptinessCopy, noReorderingCopy } from "../retrieval/model"
import { RankingTable, SourceCell } from "../retrieval/ranking-table"
import { retrieverSentence, scoreHeader } from "../score"
import { withTenant } from "../tenant"
import type { AssembledContext, Collection, ComponentsOutput, Hit, ListOutput, RunOutput } from "../types"
import { useWide } from "../use-wide"

const QUERY_CAP = 8192

type Tab = "ranking" | "context" | "left-out"

/** A run as the page keeps it: what came back, plus the min score it was asked with. */
interface Shown {
  run: RunOutput
  context: AssembledContext
  minScore: number
}

const leftOutColumns: Column<Hit>[] = [
  { id: "vector_rank", header: "Vector rank", cell: (h) => <span className="tabular-nums">{h.vector_rank}</span> },
  { id: "score", header: "Vector score", cell: (h) => <span className="font-mono text-xs tabular-nums">{formatScore(h.vector_score)}</span> },
  {
    id: "chunk",
    header: "Chunk",
    className: "font-medium",
    cell: (h) => (h.chunk ? <span className="line-clamp-2">{h.chunk.content}</span> : <span className="text-muted-foreground">no chunk</span>),
  },
  { id: "source", header: "Source", cell: (h) => <SourceCell hit={h} /> },
]

/** "" is 0, the server's default. Anything but a whole number is NaN. */
function wholeOrZero(raw: string): number {
  const t = raw.trim()
  if (t === "") return 0
  return /^\d+$/.test(t) ? Number(t) : Number.NaN
}

function scoreOrZero(raw: string): number {
  const t = raw.trim()
  if (t === "") return 0
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : Number.NaN
}

export const RetrievalPage: ComponentType<PluginPageProps> = () => {
  const report = useQuery<ComponentsOutput>("system.components", {})
  const collections = useQuery<ListOutput<Collection>>("collections.list", { limit: 100 })
  const run = useCommand<RunOutput>("retrieval.run")
  const wide = useWide()

  const [query, setQuery] = useState("")
  const [collectionId, setCollectionId] = useState("")
  const [tenant, setTenant] = useState<string | null>(null)
  const [topK, setTopK] = useState("")
  const [minScore, setMinScore] = useState("")
  const [maxTokens, setMaxTokens] = useState("")
  const [shown, setShown] = useState<Shown | null>(null)
  const [tab, setTab] = useState<Tab>("ranking")
  const [selected, setSelected] = useState(-1)

  const topKN = wholeOrZero(topK)
  const minScoreN = scoreOrZero(minScore)
  const maxTokensN = wholeOrZero(maxTokens)
  const tooLong = utf8Length(query) > QUERY_CAP
  const badNumber = Number.isNaN(topKN) || Number.isNaN(minScoreN) || Number.isNaN(maxTokensN)
  const canRun = !run.loading && query.trim() !== "" && !tooLong && !badNumber
  const components = report.data?.components
  const config = report.data?.config

  async function submit(event: FormEvent) {
    event.preventDefault()
    // Enter submits the form, so this checks again rather than trusting the
    // disabled button.
    if (!canRun) return
    const payload = withTenant(
      {
        query,
        ...(collectionId !== "" ? { collection_id: collectionId } : {}),
      },
      tenant,
    )
    const answer = await run.execute({ ...payload, top_k: topKN, min_score: minScoreN, max_tokens: maxTokensN })
    // A failed run leaves the last result on screen; its error shows above.
    if (answer === undefined) return
    setShown({ run: answer, context: answer.context, minScore: minScoreN })
    setSelected(-1)
    setTab("ranking")
  }

  const result = shown?.run.result
  const empty = result ? emptiness(result, shown.minScore) : null
  const selectedHit = result && selected >= 0 ? result.hits[selected] : undefined
  const inspector = selectedHit ? <Inspector hit={selectedHit} label={`Hit ${selectedHit.rank}`} /> : null

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title="Retrieval" description="Ask what your app would ask, and see what the retriever ranked and what a model would be handed." />

      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 rounded-md border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="retrieval-query">Query</Label>
          <Input id="retrieval-query" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="What did the user ask?" />
          {tooLong ? (
            <p role="alert" className="text-sm text-destructive">
              Queries are capped at 8 KiB. This one is {utf8Length(query)} bytes.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="retrieval-collection">Collection</Label>
            <NativeSelect id="retrieval-collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              <NativeSelectOption value="">All collections</NativeSelectOption>
              {(collections.data?.items ?? []).map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <TenantFilter value={tenant} onChange={setTenant} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="retrieval-topk">Top K</Label>
            <Input id="retrieval-topk" inputMode="numeric" className="w-20 font-mono" placeholder={config ? String(config.default_top_k) : ""} value={topK} onChange={(e) => setTopK(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="retrieval-min">Min score</Label>
            <Input id="retrieval-min" inputMode="decimal" className="w-20 font-mono" placeholder="0" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="retrieval-budget">Budget</Label>
            <Input id="retrieval-budget" inputMode="numeric" className="w-24 font-mono" placeholder="4096" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </div>
          <Button type="submit" disabled={!canRun}>
            {run.loading ? "Running…" : "Run query"}
          </Button>
        </div>
        {badNumber ? <p role="alert" className="text-sm text-destructive">Top K and the budget take whole numbers; min score takes a number of 0 or more.</p> : null}
      </form>

      <CommandAlert title="The query did not run" error={run.error} />

      {!shown || !result ? (
        <EmptyState
          title="Ask Weave a question"
          description="Run a query to see the ranking the retriever produced, the raw vector ranking beside it, and the context a model would read."
        />
      ) : (
        <>
          <div className="flex flex-col gap-1 text-sm">
            {components ? <p>{retrieverSentence(components)}</p> : null}
            <p className="tabular-nums">
              {plural(result.hits.length, "hit", "hits")} in {formatMs(result.retriever_ms)}. Vector search returned {result.vector_matches} of a {result.window} window in{" "}
              {formatMs(result.vector_ms)}.{result.same_search ? " Both sides are the same vector search, so they can't disagree." : ""}
            </p>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(String(v) as Tab)}>
            <TabsList variant="line">
              <TabsTrigger value="ranking">Ranking</TabsTrigger>
              <TabsTrigger value="context">Context sent to the model</TabsTrigger>
              <TabsTrigger value="left-out">Left out ({result.left_out.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="ranking">
              {empty ? (
                <p className="py-6 text-sm">{emptinessCopy(empty)}</p>
              ) : (
                <div className={wide ? "grid grid-cols-[minmax(0,1fr)_22rem] gap-4" : "flex flex-col"}>
                  <RankingTable
                    hits={result.hits}
                    context={shown.context}
                    scoreLabel={scoreHeader(result.score, components?.vector_store.score)}
                    selected={selected}
                    onSelect={setSelected}
                  />
                  {wide ? (
                    <aside className="rounded-md border p-3">
                      {inspector ?? <p className="text-sm text-muted-foreground">Pick a hit to see its full text, where it came from and its metadata.</p>}
                    </aside>
                  ) : (
                    <Sheet open={selectedHit !== undefined} onOpenChange={(open) => (open ? null : setSelected(-1))}>
                      <SheetContent>
                        <SheetHeader>
                          <SheetTitle>{selectedHit ? `Hit ${selectedHit.rank}` : "Hit"}</SheetTitle>
                        </SheetHeader>
                        {inspector}
                      </SheetContent>
                    </Sheet>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="context">
              <ContextView
                key={shown.run.context.context}
                hits={result.hits}
                context={shown.context}
                onContext={(next) => setShown({ ...shown, context: next })}
                onMarker={(index) => {
                  setSelected(index)
                  setTab("ranking")
                }}
              />
            </TabsContent>

            <TabsContent value="left-out">
              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  Strong vector matches inside the scanned window that the retriever didn't return. Their scores are vector scores.
                </p>
                {result.left_out.length === 0 ? (
                  <p className="text-sm">
                    {noReorderingCopy(result, components) ?? "Nothing above the retriever's weakest hit was left out."}
                  </p>
                ) : (
                  <ResourceTable<Hit>
                    columns={leftOutColumns}
                    rows={result.left_out}
                    rowKey={(h) => `${h.vector_rank}`}
                    caption={plural(result.left_out.length, "match left out", "matches left out")}
                    emptyMessage="Nothing was left out."
                  />
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </section>
  )
}
```

Notes for this step:
- The `ContextView` is keyed by the run's original context, so a new run resets its budget field and its assemble state, while a re-assemble within one run does not.
- The empty-run copy replaces the table, and the tabs stay, because the Context and Left out tabs still say something true about an empty run.
- `Tabs` comes from base-ui; `plugin-sentinel/src/pages/suite-detail.tsx` shows the props it takes (`value`, `onValueChange`, `TabsList variant="line"`). If a hidden panel stays in the DOM, `getByText` assertions about one tab can match another tab's text: scope them with `within` or check the panel's `hidden` attribute, and say what you found.
- The page never writes to the address. There is nothing to restore after a reload, and that is deliberate: a query can hold customer text.

- [ ] **Step 8: Register the page**

In `src/index.tsx`, import `ScanSearchIcon` and `RetrievalPage`, export `RetrievalPage`, add `{ label: "Retrieval", to: "/retrieval", priority: 0, icon: <ScanSearchIcon />, group: "RAG" }` to `nav` and `{ path: "/retrieval", element: RetrievalPage }` to `routes`.

- [ ] **Step 9: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-weave test && pnpm --filter @forge-go/dashboard-plugin-weave typecheck && pnpm --filter @forge-go/dashboard-plugin-weave lint`
Expected: PASS. Two things to check by eye rather than by test, and report: the budget row really spans the table (`colSpan={5}`), and the dimmed rows are still readable.

- [ ] **Step 10: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-weave/src/use-wide.ts packages/plugin-weave/src/retrieval/ranking-table.tsx packages/plugin-weave/src/retrieval/inspector.tsx packages/plugin-weave/src/retrieval/context-view.tsx packages/plugin-weave/src/pages/retrieval.tsx packages/plugin-weave/test/retrieval.test.tsx
git commit --only -m "feat(plugin-weave): add the retrieval page" -m "<body>" -- packages/plugin-weave/src/use-wide.ts packages/plugin-weave/src/retrieval/ranking-table.tsx packages/plugin-weave/src/retrieval/inspector.tsx packages/plugin-weave/src/retrieval/context-view.tsx packages/plugin-weave/src/pages/retrieval.tsx packages/plugin-weave/src/index.tsx packages/plugin-weave/test/retrieval.test.tsx packages/plugin-weave/test/plugin.test.tsx
git show --stat HEAD
```

Body, for example: you see the ranking the retriever produced beside the raw vector ranking, which hits made the context budget and which fell off, and the context itself with each marker linked to its hit. Orphaned and unidentified hits keep their rank, and the query never goes into the address.

---
### Task 14: Mount the plugin in the shell and the Next example

**Files:**
- Modify: `apps/shell/package.json`, `apps/shell/src/App.tsx`, `apps/shell/src/styles.css`
- Modify: `apps/example-next/package.json`, `apps/example-next/forge.config.ts`, `apps/example-next/app/globals.css`
- Modify (through `pnpm install`): `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `weavePlugin` (default export of `@forge-go/dashboard-plugin-weave`).

Read each file before you touch it and run `git diff` on it: other sessions edit these. Use the Edit tool only, and put every line you add on its own line so each committed hunk contains `weave`.

- [ ] **Step 1: Wire the shell**

- `apps/shell/package.json`: add `"@forge-go/dashboard-plugin-weave": "workspace:*",` to `dependencies`, after `"@forge-go/dashboard-plugin-warden"` (alphabetical).
- `apps/shell/src/App.tsx`: add `import weavePlugin from "@forge-go/dashboard-plugin-weave"` after the herald import, and `weavePlugin,` after `heraldPlugin,` in the `plugins` array.
- `apps/shell/src/styles.css`: add `@source "../../../packages/plugin-weave/src";` after the last `@source` line. Vite does not scan the module graph for Tailwind classes, so without it the plugin's own classes (the span map's positioning, `line-clamp-2`, the grid that puts the inspector beside the ranking) would be missing in the shell.

- [ ] **Step 2: Wire the Next example**

- `apps/example-next/package.json`: add the same dependency after `"@forge-go/dashboard-plugin-trove"`.
- `apps/example-next/forge.config.ts`: `import weavePlugin from "@forge-go/dashboard-plugin-weave"` after the trove import, and append `weavePlugin` to `plugins`.
- `apps/example-next/app/globals.css`: add `@source "../../../packages/plugin-weave/src/**/*.{ts,tsx}";` after the sentinel line.

- [ ] **Step 3: Install and build**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm install
pnpm --filter @forge-go/dashboard-shell build > "$W/weave-shell-build.log" 2>&1; echo "exit $?"
tail -40 "$W/weave-shell-build.log"
```

Expected: install links the plugin into both apps and the shell build succeeds. If the build fails for a reason that has nothing to do with weave (another session's uncommitted shell files), record the error, run `pnpm --filter @forge-go/dashboard-shell exec tsc --noEmit -p .` if it exists, and report BLOCKED with both outputs. Don't fix another session's files.

Check the build split the document page: search the build output for a chunk named after `document-detail` and confirm the entry chunk does not contain `useVirtualizer`:

```bash
ls apps/shell/dist/assets | grep -i -E "document-detail|index-" 
grep -l "useVirtualizer\|measureElement" apps/shell/dist/assets/*.js
```

The second command may list chunks from other plugins (Trove's browser virtualises too). It must not list the entry chunk `index-*.js` that `apps/shell/dist/index.html` loads with `<script type="module">`. Say what you found.

- [ ] **Step 4: Commit with the helper**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
bash "$W/commit-mine.sh" \
  -m "feat(shell): mount the weave plugin" \
  -m "<body>" \
  --shared apps/shell/package.json:weave apps/shell/src/App.tsx:eave apps/shell/src/styles.css:plugin-weave apps/example-next/package.json:weave apps/example-next/forge.config.ts:eave apps/example-next/app/globals.css:plugin-weave pnpm-lock.yaml:plugin-weave
git show HEAD
```

Confirm every hunk names weave and nothing from another session is in the commit. If the lockfile has no weave hunk left (Task 1 already committed it and `pnpm install` changed nothing), drop `pnpm-lock.yaml:plugin-weave` from the command, because the helper refuses a shared path with no matching hunk. Body, for example: the shell and the Next example load the weave plugin, and the shell's stylesheet scans its sources so its own classes reach the build.

---

### Task 15: Verify the slice and record what it found

Run by the controller, not a subagent: it needs the in-app browser, and it writes the hand-off.

- [ ] **Step 1: Package and repo checks**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-weave test
pnpm --filter @forge-go/dashboard-plugin-weave typecheck
pnpm --filter @forge-go/dashboard-plugin-weave lint
pnpm -r test > "$W/weave-r-test.log" 2>&1; tail -40 "$W/weave-r-test.log"
```

Expected: the weave package is clean. In `pnpm -r test`, `packages/host/test/setup-screen.test.tsx` and a couple of known timing races fail for reasons that have nothing to do with this slice; any failure that mentions weave is ours.

Scan the slice for dashes and attribution:

```bash
git log --format='%H%n%B' <first slice-2 commit>^..HEAD -- packages/plugin-weave packages/fixture-server apps BASELINE.md | perl -CSD -ne 'print "$.: $_" if /\x{2014}|\x{2013}|Co-Authored|Claude|Anthropic/'
find packages/plugin-weave/src packages/plugin-weave/test packages/fixture-server/weave-fixtures.mjs packages/fixture-server/weave-verify.mjs -type f -exec perl -CSD -ne 'print "$ARGV:$.: $_" if /\x{2014}|\x{2013}/; close ARGV if eof' {} +
```

Both must print nothing.

- [ ] **Step 2: Re-measure the entry chunk**

From the build in Task 14 (rebuild if anything changed since): record the entry script's raw and gzip size, the document page's lazy chunk and what it imports, and whether any eager script names `useVirtualizer`. Compare with the last section of `BASELINE.md` and append a section headed `### Weave's chunk reader stays out of the entry`, in the voice and shape of the sections above it: numbers first, then what was checked and how, then a note that chunk hashes change with every entry edit. Commit it with the helper, `--shared BASELINE.md:Weave` (the heading carries the needle, so the new section is one hunk that contains it).

- [ ] **Step 3: Click through every page against the fixture**

Add two launch configurations to `.claude/launch.json` beside the existing paired ones, so this walk doesn't share a port with another session's servers: `weave-fixture` running `FIXTURE_PORT=8399 node packages/fixture-server/server.mjs` on port 8399, and `weave-shell` running `cd apps/shell && FORGE_DASHBOARD_BACKEND=http://localhost:8399 npx vite --port 5399 --strictPort` on port 5399. Don't commit `launch.json` unless it is already tracked and the diff is only yours.

Start both with `preview_start`, open the shell, find the RAG group and check, page by page, against the spec:
- Overview: one stalled, one failed, the newest documents with the stalled marker, the components strip.
- Retrieval: ask "refund parcel store credit" with Top K 5 and Budget 60. See the ranking with movement arrows, an orphaned hit or one in Left out, the budget line, the context with markers that jump to their rows, and Re-assemble at 400 changing the context. Ask with Min score 0.95 and read the min-score empty. Restart the fixture with `FIXTURE_WEAVE_RETRIEVER=none` and read the deployment-wide "No reordering" line; with `FIXTURE_WEAVE_EMBEDDER=none` read the server's message.
- Collections: create one with chunk size 40 and no overlap, see the refusal before sending; create a valid one and land on its page; rename it and see the new name on Documents; reindex `support-articles`; with `FIXTURE_WEAVE_REINDEX=fail`, see the partial-index note inside the dialog; delete the new collection.
- Ingest: paste text and see "Ready"; paste the same text and see the duplicate with its two links; paste text containing `FIXTURE_FAIL_EMBED` and see the failed answer; pick a `.md` file.
- Documents: filter by state and collection, follow a link from the duplicate, clear the filters; open "Shipping FAQ" and see the gap in the span map and the scale note, the chunk reader with overlap marked, and copy the hash.
- Chunks: pick `support-articles`, open a chunk, step with Previous and Next; open the orphaned chunk (`WEAVE_IDS.orphanChunk` in the fixture) and see "document deleted".
- Pipeline: every stage, the loader's content types, the config, the extensions.

Take a screenshot of each page and look at it. Note anything unstyled, clipped or misaligned, at desktop width and at the mobile preset (the inspector must become a sheet). Fix what is ours in a follow-up commit and record what isn't.

- [ ] **Step 4: Record what slice 2 found that slice 4 must know**

Append a section headed `## What slice 2 found that slice 4 must know` to the spec, in Rex's voice (invoke `rex-voice`, then run the draft through `humanizer` in embedded mode; no em or en dashes). Cover:
- where every page reads from and writes to (intent by route), so slice 4 can walk the real Go contract page by page;
- the fixture's deliberate differences from the real server (word-overlap scores, the greedy "MMR", the trimmed chunk, `FIXTURE_FAIL_EMBED`, the three switches), and that slice 4 must see the same pages against real Weave;
- the client-side checks that mirror server rules (overlap against size, the 8 KiB query cap, the 1 MiB content cap and the transport limit), so slice 4 can confirm the server refuses the same inputs with the same words;
- the entry-chunk numbers from Step 2;
- anything the click-through in Step 3 found, fixed or not.

Commit only the spec:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git commit --only -m "docs: record what weave slice 2 found" -m "<body>" -- docs/superpowers/specs/2026-10-07-weave-dashboard-migration-design.md
git show --stat HEAD
```

If `git add` would refuse the spec because another session's `.gitignore` ignores `docs/`, that's fine: the file is tracked, and `git commit --only -- <path>` commits it on its own.
