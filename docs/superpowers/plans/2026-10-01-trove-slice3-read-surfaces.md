# Trove slice 3: plugin read surfaces, fixtures and wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/plugin-trove` with the Overview, Buckets, Middleware, CAS and Transfers pages, give the fixture server a `trove` contributor answering all 20 intents, and mount the plugin in `apps/shell` and `apps/example-next`.

**Architecture:** A plugin package shaped like `packages/plugin-vault`: one file per page under `src/pages`, shared wire types in `src/types.ts`, badges in `src/badges.tsx`, and a tiny store-selection module so every page sends the same optional `store`. Pages read through `useQuery`/`useCommand` only, render with kit components, and are tested with a stub client that refuses unknown intents. The fixture is a self-contained `trove-fixtures.mjs` modelling the contract slice 2 shipped.

**Tech Stack:** React 19, TypeScript 6, vitest 5 + Testing Library + jsdom, `@forge-go/dashboard-plugin` (useQuery, useCommand, usePoll, PluginLink, definePlugin), `@forge-go/dashboard-kit` components and lucide icons via `@forge-go/dashboard-kit/icons`. Node 20 for the fixture server.

**Spec:** `docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md`, sections "The React half" (Information architecture, Overview, Buckets, Middleware, CAS, Transfers, Badges, Wiring), "Fixtures", and the authoritative "What slice 2 found that slice 3 must know" section at the end. Where the older tables and the slice 2 section disagree, the slice 2 section wins.

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. No worktrees. Other sessions keep 100+ uncommitted files here and some stage files.
- You may edit only: `packages/plugin-trove/**` (new), `packages/fixture-server/trove-fixtures.mjs` (new), trove's entries in `packages/fixture-server/server.mjs` and `verify.mjs`, plugin wiring in `apps/shell` (`package.json`, `src/App.tsx`) and `apps/example-next` (`package.json`, `forge.config.ts`, `app/globals.css`), and `pnpm-lock.yaml` through `pnpm install`. Nothing else. Never edit `apps/shell/src/styles.css` (another session's untracked file), the kit, the host or another plugin.
- Commits for files that are wholly yours (the plugin package, `trove-fixtures.mjs`): `git add <explicit files>` then `git commit --only -m "..." -m "..." -- <explicit paths>`, then `git show --stat HEAD`. The shell is zsh: write paths out, never `git add $F`.
- Commits that touch a SHARED file (`pnpm-lock.yaml`, `server.mjs`, `verify.mjs`, `apps/shell/package.json`, `apps/shell/src/App.tsx`, the example-next files): use the helper `commit-mine.sh` (its full text is under "The commit-mine helper" below; the controller places it at `$W/commit-mine.sh`). Pass your own new files with `--whole` and each shared file as `--shared path:NEEDLE` where NEEDLE is a string every one of your hunks in that file contains (`trove`). Then run `git show HEAD -- <shared path>` and confirm no line from another session is in it.
- NEVER run `git add -A`, `git add .`, `git checkout -- .`, `git restore .`, `git reset --hard`, `git stash`, `git clean` or `--amend`. Never a bare `git reset`.
- Commit messages: no `Co-Authored-By`, no AI attribution, no em or en dashes. Body: plain prose, "you" where natural, 2 to 5 lines.
- No em or en dashes anywhere in code, comments, test names, UI copy.
- `extension: "trove"`, `namespace: "trove"`, `label: "Storage"`. Nav group "Storage".
- Every query and command sends `store` only when the operator picked a non-default store; otherwise the field is absent (never `""`). Use `withStore(store, params)`.
- The five conventions: identifiers (keys, hashes, ETags, bucket names, byte sizes, driver names, scopes) carry `font-mono text-xs`; the column an operator reads carries `font-medium`; every table caption carries a live count including at zero; a "none" cell uses `NoneCell`/`TagList`/`Timestamp`, never a blank or a bare dash; badge colour follows proportion (table below).
- Badge mapping (spec, binding): protection flags: applied `outline` "Applied", not configured `secondary` "Not configured", configured but not applied `destructive` "Configured, not applied". CAS entries: indexed with refs `outline` "Indexed", pinned `secondary` "Pinned", refs 0 and unpinned `default` "GC candidate", not indexed `destructive` "Not indexed". Streams: active `outline`, idle/paused `secondary`, completing/completed `default`, failed/cancelled `destructive` (label is the state). Health: healthy `outline` "Healthy", unhealthy `destructive` "Unhealthy".
- Never show an object count, a total size, or any total the drivers cannot produce. Never render a protection as "encrypted", "scanned", "secure" or "protected" on a row; the flag table says configured versus applied.
- Errors from a command shown in a dialog render INSIDE the dialog (`CommandAlert` in the dialog body). Call `reset()` when a dialog OPENS. Every `ConfirmDialog` gets `pending`. A dialog must not close on Escape while its command is in flight.
- Tests use the plugin's `test/harness.tsx` (`stubClient` refuses any intent not in its map). `execute()` resolves `undefined` only when the client throws, so failure tests use a client that throws `ContractError`, never one answering `{ ok: false }`.
- Per package: `pnpm --filter @forge-go/dashboard-plugin-trove test`, `typecheck` and `lint` all clean before every commit of the package.
- No new runtime dependencies in this slice. The package's `dependencies` field is empty; dev and peer dependencies mirror `plugin-vault`'s exactly.

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
#           against HEAD (zero context) that contain NEEDLE are committed.
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
  git diff -U0 "$old_head" -- "$p" > "$tmp/full.patch"
  python3 - "$needle" "$tmp/full.patch" > "$tmp/mine.patch" <<'PY'
import sys
needle, path = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().splitlines(keepends=True)
head, hunks, cur = [], [], None
for line in lines:
    if line.startswith("@@"):
        cur = [line]
        hunks.append(cur)
    elif cur is None:
        head.append(line)
    else:
        cur.append(line)
keep = [h for h in hunks if any(needle in l for l in h[1:])]
if keep:
    sys.stdout.write("".join(head) + "".join("".join(h) for h in keep))
PY
  if [ ! -s "$tmp/mine.patch" ]; then echo "commit-mine: no hunk in $p mentions '$needle'" >&2; exit 1; fi
  git apply --cached --unidiff-zero "$tmp/mine.patch"
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
      fmode=$(git ls-tree HEAD -- "$f" | awk '{print $1}')
      git update-index --add --cacheinfo "$fmode,$new,$f"
    else
      echo "commit-mine: left $f alone in the shared index; someone has it staged" >&2
    fi
  done < <(git ls-tree -r --name-only HEAD -- "$p")
done
git show --stat HEAD
```

## Review Focus

1. A store name remembered from an earlier visit that no longer exists (renamed or removed) must not leave every page failing: the picker falls back to the default store. Pinned in Task 1 (`StorePicker` test "falls back to the default when the remembered store is gone").
2. A protection that is applied but only within a scope arrives as `applied: true` with a note; the badge says "Applied" and the note must be on screen beside it, never hidden. Pinned in Task 2 ("shows the scope note next to an applied flag").
3. Deleting a bucket that still holds objects answers CONFLICT; the message must appear inside the still-open dialog, not behind it. Pinned in Task 3 ("keeps the delete dialog open and shows the refusal inside it").
4. The middleware "Test a key" form with only a bucket or only a key must not send a half test (the server then returns null matches and the page would read as "never runs"). Pinned in Task 4 ("does not test until both bucket and key are filled").
5. A store with CAS switched off must show only that fact and never ask for `cas.list` (which answers UNAVAILABLE and would put an error card on the page). Pinned in Task 5 ("does not ask for cas.list when CAS is off").

---

### Task 1: Package scaffold, shared modules and the plugin definition

**Files:**
- Create: `packages/plugin-trove/package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- Create: `packages/plugin-trove/src/types.ts`, `src/store.ts`, `src/format.ts`, `src/badges.tsx`, `src/components/bytes.tsx`, `src/components/store-picker.tsx`, `src/index.tsx`
- Test: `packages/plugin-trove/test/harness.tsx`, `test/format.test.ts`, `test/badges.test.tsx`, `test/store.test.tsx`, `test/plugin.test.tsx`
- Modify (through `pnpm install`): `pnpm-lock.yaml`

**Interfaces:**
- Produces (later tasks import these exact names):
  - `src/types.ts`: `FlagStatus`, `SystemStatus`, `StoreRow`, `StoresList`, `BucketRow`, `BucketsList`, `MiddlewareRegistration`, `MiddlewareWarning`, `MiddlewareList`, `CasStatus`, `CasEntry`, `CasList`, `CasGCResult`, `StreamRow`, `StreamsList`
  - `src/store.ts`: `useActiveStore(): string`, `setActiveStore(name: string): void`, `withStore<T extends Record<string, unknown>>(store: string, params: T): T & { store?: string }`
  - `src/format.ts`: `formatBytes(n: number): string` (exact, "4,812 B"), `humanBytes(n: number): string` ("4.7 KiB")
  - `src/components/bytes.tsx`: `Bytes({ value }: { value: number })`
  - `src/components/store-picker.tsx`: `StorePicker()`
  - `src/badges.tsx`: `FlagStateBadge({ flag })`, `HealthBadge({ ok })`, `CasStateBadge({ entry })`, `StreamStateBadge({ state })`
  - `test/harness.tsx`: `stubClient`, `recordingQueryClient`, `recordingCommandClient`, `failingClient`, `renderPage` (Vault's harness with `extension: "trove"`, and `beforeEach` also calls `setActiveStore("")`)
  - `src/index.tsx`: `trovePlugin` (default and named export) with `nav: []` and `routes: []` in this task; Tasks 2 to 6 each add their nav entry and route.

- [ ] **Step 1: Create the package config**

`packages/plugin-trove/package.json`:

```json
{
  "name": "@forge-go/dashboard-plugin-trove",
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

Copy `tsconfig.json`, `vitest.config.ts` and `eslint.config.js` byte for byte from `packages/plugin-vault/` (they carry no vault-specific content).

Then from the repo root: `pnpm install`. Expected: it links the new package and adds a `packages/plugin-trove:` importer block to `pnpm-lock.yaml`. Check `git diff pnpm-lock.yaml` and confirm your block is separate from any other session's hunks (another session has uncommitted `plugin-bastion` entries there).

- [ ] **Step 2: Write the test harness**

`packages/plugin-trove/test/harness.tsx`: copy `packages/plugin-vault/test/harness.tsx` verbatim, then change the three `extension: "vault"` literals to `extension: "trove"`, add `import { setActiveStore } from "../src/store"`, and make the `beforeEach` read:

```ts
beforeEach(() => {
  queryStore.clear()
  // The active store is module state that outlives a test, like queryStore.
  setActiveStore("")
})
```

- [ ] **Step 3: Write the failing tests**

`test/format.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { formatBytes, humanBytes } from "../src/format"

describe("formatBytes", () => {
  it("gives the exact byte count with grouping", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(4812)).toBe("4,812 B")
    expect(formatBytes(67108864)).toBe("67,108,864 B")
  })
})

describe("humanBytes", () => {
  it("uses binary units with one decimal below ten", () => {
    expect(humanBytes(512)).toBe("512 B")
    expect(humanBytes(4812)).toBe("4.7 KiB")
    expect(humanBytes(67108864)).toBe("64 MiB")
    expect(humanBytes(1536 * 1024 * 1024)).toBe("1.5 GiB")
  })
})
```

`test/badges.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import { CasStateBadge, FlagStateBadge, HealthBadge, StreamStateBadge } from "../src/badges"

type Variant = "default" | "secondary" | "destructive" | "outline"

/**
 * The kit's Badge carries no data-variant attribute, so a badge's variant is
 * read by comparing its classes with a reference Badge of each variant.
 */
function variantOf(text: string): Variant | null {
  const el = screen.getByText(text)
  for (const v of ["default", "secondary", "destructive", "outline"] as const) {
    const { container, unmount } = render(<Badge variant={v}>ref</Badge>)
    const ref = container.firstElementChild?.className
    unmount()
    if (ref === el.className) return v
  }
  return null
}

describe("FlagStateBadge", () => {
  it.each([
    [{ name: "encryption", configured: true, applied: false, note: null }, "Configured, not applied", "destructive"],
    [{ name: "compression", configured: true, applied: true, note: null }, "Applied", "outline"],
    [{ name: "scanning", configured: false, applied: true, note: null }, "Applied", "outline"],
    [{ name: "cas", configured: false, applied: false, note: null }, "Not configured", "secondary"],
  ])("%o reads %s as %s", (flag, text, variant) => {
    render(<FlagStateBadge flag={flag} />)
    expect(variantOf(text)).toBe(variant)
  })
})

describe("HealthBadge", () => {
  it("is outline when healthy and destructive when not", () => {
    render(<><HealthBadge ok /><HealthBadge ok={false} /></>)
    expect(variantOf("Healthy")).toBe("outline")
    expect(variantOf("Unhealthy")).toBe("destructive")
  })
})

describe("CasStateBadge", () => {
  const base = { hash: "sha256:a", storedSize: 1, lastModified: null }
  it.each([
    [{ ...base, indexed: true, refCount: 2, pinned: false }, "Indexed", "outline"],
    [{ ...base, indexed: true, refCount: 1, pinned: true }, "Pinned", "secondary"],
    [{ ...base, indexed: true, refCount: 0, pinned: false }, "GC candidate", "default"],
    [{ ...base, indexed: false, refCount: null, pinned: null }, "Not indexed", "destructive"],
  ])("%o reads %s as %s", (entry, text, variant) => {
    render(<CasStateBadge entry={entry} />)
    expect(variantOf(text)).toBe(variant)
  })
})

describe("StreamStateBadge", () => {
  it.each([
    ["active", "outline"],
    ["idle", "secondary"],
    ["paused", "secondary"],
    ["completing", "default"],
    ["completed", "default"],
    ["failed", "destructive"],
    ["cancelled", "destructive"],
  ])("%s is %s", (state, variant) => {
    render(<StreamStateBadge state={state} />)
    expect(variantOf(state)).toBe(variant)
  })
})
```

`variantOf` compares classes with a reference `Badge`, because the kit's Badge renders no `data-variant`. If `getByText` lands on an inner element rather than the badge root, walk up with `closest('[data-slot="badge"]')` (check what `badge.tsx` renders) and say so in your report.

`test/store.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor } from "@testing-library/react"
import { renderPage, stubClient } from "./harness"
import { setActiveStore, useActiveStore, withStore } from "../src/store"
import { StorePicker } from "../src/components/store-picker"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"

const MULTI = {
  mode: "multi",
  stores: [
    { name: "primary", driver: "local", isDefault: true },
    { name: "archive", driver: "s3", isDefault: false },
  ],
}

function Probe(_: PluginPageProps) {
  const store = useActiveStore()
  return (
    <div>
      <StorePicker />
      <output aria-label="active store">{store === "" ? "(default)" : store}</output>
    </div>
  )
}

describe("withStore", () => {
  it("leaves store out for the default and adds it otherwise", () => {
    expect(withStore("", { bucket: "b" })).toEqual({ bucket: "b" })
    expect("store" in withStore("", {})).toBe(false)
    expect(withStore("archive", { bucket: "b" })).toEqual({ bucket: "b", store: "archive" })
  })
})

describe("StorePicker", () => {
  it("renders nothing for a single store", async () => {
    renderPage(Probe, stubClient({ "stores.list": { mode: "single", stores: [{ name: "default", driver: "mem", isDefault: true }] } }))
    await screen.findByText("(default)")
    expect(screen.queryByLabelText("Store")).toBeNull()
  })

  it("lists every store and switches the active one", async () => {
    renderPage(Probe, stubClient({ "stores.list": MULTI }))
    const select = (await screen.findByLabelText("Store")) as HTMLSelectElement
    expect(select.value).toBe("primary")
    fireEvent.change(select, { target: { value: "archive" } })
    expect(screen.getByLabelText("active store").textContent).toBe("archive")
    fireEvent.change(select, { target: { value: "primary" } })
    // Choosing the default stores "", so queries leave store out.
    expect(screen.getByLabelText("active store").textContent).toBe("(default)")
  })

  it("falls back to the default when the remembered store is gone", async () => {
    act(() => setActiveStore("retired"))
    renderPage(Probe, stubClient({ "stores.list": MULTI }))
    await waitFor(() => expect(screen.getByLabelText("active store").textContent).toBe("(default)"))
  })
})
```

`test/plugin.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { resolvePluginState } from "@forge-go/dashboard-plugin"
import type { Capabilities } from "@forge-go/dashboard-plugin"
import trovePlugin, { trovePlugin as named } from "../src/index"

function capabilities(...names: string[]): Capabilities {
  return {
    shellEnvelopes: ["v1"],
    contributors: names.map((name) => ({ name, envelopes: ["v1"], configured: true })),
  }
}

describe("trovePlugin", () => {
  it("is the default export as well as a named one", () => {
    expect(trovePlugin).toBe(named)
  })

  // The join key, checked against what the host does with it rather than
  // compared to itself: trove/extension/contract/manifest.yaml registers the
  // contributor as "trove".
  it("resolves to ready against a host reporting trove's contributor", () => {
    expect(resolvePluginState(trovePlugin, capabilities("trove"))).toEqual({ kind: "ready" })
  })

  it("is hidden when the host does not report trove", () => {
    expect(resolvePluginState(trovePlugin, capabilities("vault")).kind).toBe("hidden")
  })

  it("mounts under the trove namespace with the Storage label", () => {
    expect(trovePlugin.namespace).toBe("trove")
    expect(trovePlugin.label).toBe("Storage")
  })
})
```

Tasks 2 to 6 each append an `it` to this file checking their nav entry and route.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL, modules not found.

- [ ] **Step 5: Write the shared modules**

`src/types.ts`:

```ts
/**
 * Wire types for the trove contract. Field names are the Go JSON tags in
 * trove/extension/contract (handlers_*.go, project.go, middleware.go). An
 * absent value arrives as null, never "" or 0.
 */

export interface FlagStatus {
  name: string
  configured: boolean
  applied: boolean
  /** Says where a protection applies, or why it does not. */
  note: string | null
}

export interface SystemStatus {
  store: string
  driver: string
  health: { ok: boolean; error: string | null }
  capabilities: {
    multipart: boolean
    presign: boolean
    range: boolean
    serverCopy: boolean
    versioning: boolean
    notification: boolean
    lifecycle: boolean
    folders: boolean
  }
  config: {
    defaultBucket: string | null
    chunkSize: number
    poolSize: number
    maxUploadBytes: number
  }
  flags: FlagStatus[]
  etagIsContentHash: boolean
  contentSecret: "configured" | "per-process"
  /** Backends registered beside the default. [] means every key goes to the default. */
  backends: string[]
  routingNote: string | null
}

export interface StoreRow {
  name: string
  driver: string
  isDefault: boolean
}

export interface StoresList {
  mode: "single" | "multi"
  stores: StoreRow[]
}

export interface BucketRow {
  name: string
  createdAt: string | null
}

export interface BucketsList {
  buckets: BucketRow[]
  /** "modified" where the driver returns a last-modified time (local, sftp, azure). */
  createdAtMeaning: "created" | "modified"
}

export interface MiddlewareRegistration {
  name: string
  direction: string
  scope: string
  priority: number
  /** null unless the request named both a bucket and a key. */
  matchesWrite: boolean | null
  matchesRead: boolean | null
}

export interface MiddlewareWarning {
  code: string
  message: string
}

export interface MiddlewareList {
  registrations: MiddlewareRegistration[]
  warnings: MiddlewareWarning[]
}

export interface CasStatus {
  enabled: boolean
  algorithm: string | null
  bucket: string | null
  index: string | null
  resetsOnRestart: boolean
  releaseSupported: boolean
}

export interface CasEntry {
  hash: string
  storedSize: number
  lastModified: string | null
  indexed: boolean
  /** null when the blob is not in the index. */
  refCount: number | null
  pinned: boolean | null
}

export interface CasList {
  entries: CasEntry[]
  nextCursor: string | null
}

export interface CasGCResult {
  scanned: number
  deleted: number
  freedBytes: number
  errors: number
}

export interface StreamRow {
  id: string
  direction: string
  bucket: string
  key: string
  state: string
  offset: number
  /** null when nobody set the expected size. */
  totalSize: number | null
}

export interface StreamsList {
  streams: StreamRow[]
  active: number
  max: number
}
```

`src/store.ts`:

```ts
import { useSyncExternalStore } from "react"

/**
 * Which store the pages are looking at. "" means the default store, and then
 * every request leaves `store` out, which is what the contract reads as the
 * default. The choice is module state, so every page shares it, and it is
 * remembered for the browser tab in sessionStorage.
 */
const STORAGE_KEY = "forge.trove.store"

function readRemembered(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

let active = readRemembered()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setActiveStore(name: string): void {
  if (name === active) return
  active = name
  try {
    if (name === "") window.sessionStorage.removeItem(STORAGE_KEY)
    else window.sessionStorage.setItem(STORAGE_KEY, name)
  } catch {
    // Storage is unavailable: the choice lasts until the page reloads.
  }
  for (const listener of listeners) listener()
}

export function useActiveStore(): string {
  return useSyncExternalStore(subscribe, () => active, () => active)
}

/** params plus `store`, or params alone for the default store. */
export function withStore<T extends Record<string, unknown>>(
  store: string,
  params: T,
): T & { store?: string } {
  return store === "" ? params : { ...params, store }
}
```

`src/format.ts`:

```ts
const grouped = new Intl.NumberFormat("en-US")
const UNITS = ["KiB", "MiB", "GiB", "TiB"]

/** The exact size: "4,812 B". This is the identifier-shaped value. */
export function formatBytes(n: number): string {
  return `${grouped.format(n)} B`
}

/** A readable size for a title or hint: "4.7 KiB". */
export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${UNITS[unit]}`
}
```

`src/components/bytes.tsx`:

```tsx
import { formatBytes, humanBytes } from "../format"

/** A byte count as the exact number, with the readable size on hover. */
export function Bytes({ value }: { value: number }) {
  return (
    <span className="font-mono text-xs tabular-nums" title={humanBytes(value)}>
      {formatBytes(value)}
    </span>
  )
}
```

`src/badges.tsx`:

```tsx
import { Badge } from "@forge-go/dashboard-kit/components/badge"
import type { CasEntry, FlagStatus } from "./types"

/**
 * Proportion first, per the playbook. A flag configured and not applied is
 * what an operator came to the page to find, so it is the only destructive
 * state. The note beside the badge says where an applied flag applies.
 */
export function FlagStateBadge({ flag }: { flag: FlagStatus }) {
  if (flag.configured && !flag.applied) return <Badge variant="destructive">Configured, not applied</Badge>
  if (flag.applied) return <Badge variant="outline">Applied</Badge>
  return <Badge variant="secondary">Not configured</Badge>
}

export function HealthBadge({ ok }: { ok: boolean }) {
  return ok ? <Badge variant="outline">Healthy</Badge> : <Badge variant="destructive">Unhealthy</Badge>
}

/**
 * Indexed blobs with references are the majority in any running process. A
 * blob the index does not know is what a restart leaves behind, and what an
 * operator came to find.
 */
export function CasStateBadge({ entry }: { entry: CasEntry }) {
  if (!entry.indexed) return <Badge variant="destructive">Not indexed</Badge>
  if (entry.pinned) return <Badge variant="secondary">Pinned</Badge>
  if (entry.refCount === 0) return <Badge variant="default">GC candidate</Badge>
  return <Badge variant="outline">Indexed</Badge>
}

const STREAM_VARIANT: Record<string, "outline" | "secondary" | "default" | "destructive"> = {
  active: "outline",
  idle: "secondary",
  paused: "secondary",
  completing: "default",
  completed: "default",
  failed: "destructive",
  cancelled: "destructive",
}

export function StreamStateBadge({ state }: { state: string }) {
  return <Badge variant={STREAM_VARIANT[state] ?? "outline"}>{state}</Badge>
}
```

`src/components/store-picker.tsx`:

```tsx
import { useEffect } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { setActiveStore, useActiveStore } from "../store"
import type { StoresList } from "../types"

/**
 * Picks the store every page reads. Renders nothing in single-store mode,
 * where there is nothing to pick. A remembered store the server no longer
 * lists falls back to the default rather than failing every page.
 */
export function StorePicker() {
  const active = useActiveStore()
  const stores = useQuery<StoresList>("stores.list", {})
  const list = stores.data
  const known = list === undefined || active === "" || list.stores.some((s) => s.name === active)

  useEffect(() => {
    if (!known) setActiveStore("")
  }, [known])

  if (!list || list.mode !== "multi") return null
  const fallback = list.stores.find((s) => s.isDefault)?.name ?? list.stores[0]?.name ?? ""
  const value = active !== "" && known ? active : fallback

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Store</span>
      <NativeSelect
        aria-label="Store"
        value={value}
        onChange={(e) => setActiveStore(e.target.value === fallback ? "" : e.target.value)}
      >
        {list.stores.map((s) => (
          <NativeSelectOption key={s.name} value={s.name}>
            {s.isDefault ? `${s.name} (default)` : s.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  )
}
```

Check `packages/kit/src/components/native-select.tsx` forwards `value`, `onChange` and `aria-label` to the `<select>`; adjust the props to what it takes if it differs, and say so in your report.

`src/index.tsx`:

```tsx
import { definePlugin } from "@forge-go/dashboard-plugin"

/**
 * The first-party UI for the `trove` extension.
 *
 * `extension` is "trove", the contributor name trove/extension/contract's
 * manifest registers, and test/plugin.test.tsx checks it by resolving against
 * a capabilities document. Every page reads the drivers through the contract;
 * nothing here reads the extension's metadata store, which normal operation
 * never writes.
 */
export const trovePlugin = definePlugin({
  extension: "trove",
  namespace: "trove",
  label: "Storage",
  nav: [],
  routes: [],
})

export default trovePlugin
```

If `definePlugin` rejects an empty `routes` array at type level or runtime, keep `routes: []` only if it type-checks; otherwise report NEEDS_CONTEXT. (Vault's plugin always has routes; empty should be legal.)

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass.

- [ ] **Step 7: Commit**

The package files are wholly yours; the lockfile is shared. Use the helper so only your lockfile hunk is committed:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
bash "$W/commit-mine.sh" \
  -m "feat(plugin-trove): scaffold the trove plugin with its shared types, badges and store picker" \
  -m "<body>" \
  --whole packages/plugin-trove/package.json packages/plugin-trove/tsconfig.json packages/plugin-trove/vitest.config.ts packages/plugin-trove/eslint.config.js packages/plugin-trove/src packages/plugin-trove/test \
  --shared pnpm-lock.yaml:plugin-trove
git show HEAD -- pnpm-lock.yaml
```
Confirm the lockfile hunk names only `plugin-trove`. (`--whole` on `src` and `test` is safe: the helper adds them to a private index that starts from HEAD.)

---

### Task 2: Overview page

**Files:**
- Create: `packages/plugin-trove/src/pages/overview.tsx`
- Modify: `packages/plugin-trove/src/index.tsx` (nav entry and route)
- Test: `packages/plugin-trove/test/overview.test.tsx`, `test/plugin.test.tsx` (one new `it`)

**Interfaces:**
- Consumes: `SystemStatus`, `FlagStatus`, `useActiveStore`, `withStore`, `StorePicker`, `FlagStateBadge`, `HealthBadge`, `Bytes` from Task 1.
- Produces: `OverviewPage: ComponentType<PluginPageProps>` exported from `src/pages/overview.tsx` and re-exported from `src/index.tsx`.

- [ ] **Step 1: Write the failing tests**

`test/overview.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { act, screen, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import { OverviewPage } from "../src/pages/overview"
import { setActiveStore } from "../src/store"
import { failingClient, recordingQueryClient, renderPage, stubClient } from "./harness"

function status(over: Record<string, unknown> = {}) {
  return {
    store: "primary",
    driver: "local",
    health: { ok: true, error: null },
    capabilities: {
      multipart: false, presign: false, range: false, serverCopy: false,
      versioning: false, notification: false, lifecycle: false, folders: true,
    },
    config: { defaultBucket: "reports", chunkSize: 8388608, poolSize: 16, maxUploadBytes: 67108864 },
    flags: [
      { name: "encryption", configured: true, applied: false, note: "enable_encryption is set, but the extension never registers the encrypt middleware. Nothing is encrypted." },
      { name: "compression", configured: true, applied: true, note: null },
      { name: "scanning", configured: false, applied: false, note: "No scan middleware is registered, so uploads are not scanned." },
      { name: "cas", configured: true, applied: true, note: null },
    ],
    etagIsContentHash: false,
    contentSecret: "configured",
    backends: [],
    routingNote: null,
    ...over,
  }
}

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("OverviewPage", () => {
  it("asks system.status for the default store without a store field", async () => {
    const { client, sent } = recordingQueryClient({ "system.status": status(), "stores.list": SINGLE })
    renderPage(OverviewPage, client)
    await screen.findByText("Encryption")
    expect(sent.find((s) => s.intent === "system.status")?.params).toEqual({})
  })

  it("sends the picked store", async () => {
    act(() => setActiveStore("archive"))
    const { client, sent } = recordingQueryClient({
      "system.status": status({ store: "archive" }),
      "stores.list": { mode: "multi", stores: [{ name: "primary", driver: "local", isDefault: true }, { name: "archive", driver: "s3", isDefault: false }] },
    })
    renderPage(OverviewPage, client)
    await screen.findByText("Encryption")
    expect(sent.find((s) => s.intent === "system.status")?.params).toEqual({ store: "archive" })
  })

  it("says plainly that configured encryption is not applied", async () => {
    renderPage(OverviewPage, stubClient({ "system.status": status(), "stores.list": SINGLE }))
    const row = rowFor("Encryption")
    expect(within(row).getByText("Configured, not applied")).toBeTruthy()
    expect(within(row).getByText(/Nothing is encrypted/)).toBeTruthy()
    expect(screen.getByText("4 protections")).toBeTruthy()
  })

  it("shows the scope note next to an applied flag", async () => {
    const scoped = status({
      flags: [{ name: "encryption", configured: true, applied: true, note: "Applies only where its scope matches: bucket(reports). Objects outside that scope are not encrypted." }],
    })
    renderPage(OverviewPage, stubClient({ "system.status": scoped, "stores.list": SINGLE }))
    const row = rowFor("Encryption")
    expect(within(row).getByText("Applied")).toBeTruthy()
    expect(within(row).getByText(/Objects outside that scope are not encrypted/)).toBeTruthy()
    expect(screen.getByText("1 protection")).toBeTruthy()
  })

  it("names the driver, its health and what it cannot do", async () => {
    renderPage(
      OverviewPage,
      stubClient({ "system.status": status({ health: { ok: false, error: "The driver did not answer a ping." } }), "stores.list": SINGLE }),
    )
    expect((await screen.findByText("local")).className).toContain("font-mono")
    expect(screen.getByText("Unhealthy")).toBeTruthy()
    expect(screen.getByText("The driver did not answer a ping.")).toBeTruthy()
    expect(screen.getByText(/this driver cannot sign one/)).toBeTruthy()
  })

  it("shows no object counts or storage totals", async () => {
    renderPage(OverviewPage, stubClient({ "system.status": status(), "stores.list": SINGLE }))
    await screen.findByText("Encryption")
    expect(screen.queryByText(/objects/i)).toBeNull()
    expect(screen.queryByText(/storage used/i)).toBeNull()
  })

  it("marks a missing default bucket as none and explains a per-process key", async () => {
    renderPage(
      OverviewPage,
      stubClient({
        "system.status": status({ config: { defaultBucket: null, chunkSize: 1024, poolSize: 4, maxUploadBytes: 1024 }, contentSecret: "per-process" }),
        "stores.list": SINGLE,
      }),
    )
    expect(await screen.findByLabelText("no default bucket")).toBeTruthy()
    expect(screen.getByText(/set dashboard_content_secret/)).toBeTruthy()
  })

  it("warns when the store routes keys to other backends", async () => {
    renderPage(
      OverviewPage,
      stubClient({
        "system.status": status({
          backends: ["cold"],
          routingNote: "This store routes some keys to other backends. Listings, bucket operations and health describe the default backend only.",
        }),
        "stores.list": SINGLE,
      }),
    )
    expect(await screen.findByText(/describe the default backend only/)).toBeTruthy()
    expect(screen.getByText("cold")).toBeTruthy()
  })

  it("shows an error card when the status cannot be read", async () => {
    renderPage(OverviewPage, failingClient(new ContractError("UNAVAILABLE", "store offline")))
    expect(await screen.findByText(/store offline/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Overview first in the Storage group at /", () => {
    const overview = trovePlugin.nav?.find((n) => n.label === "Overview")
    expect(overview?.to).toBe("/")
    expect(overview?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL, `../src/pages/overview` not found and the plugin test finds no Overview nav.

- [ ] **Step 3: Write the page**

`src/pages/overview.tsx`:

```tsx
import type { ComponentType } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { FlagStateBadge, HealthBadge } from "../badges"
import { Bytes } from "../components/bytes"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { FlagStatus, SystemStatus } from "../types"

const FLAG_LABELS: Record<string, string> = {
  encryption: "Encryption",
  compression: "Compression",
  scanning: "Content scanning",
  cas: "Content-addressable storage",
}

const flagColumns: Column<FlagStatus>[] = [
  { id: "name", header: "Protection", className: "font-medium", cell: (f) => FLAG_LABELS[f.name] ?? f.name },
  { id: "state", header: "State", cell: (f) => <FlagStateBadge flag={f} /> },
  {
    id: "note",
    header: "What it means",
    cell: (f) => (f.note ? <span className="text-sm">{f.note}</span> : <NoneCell label="note" />),
  },
]

type CapabilityKey = keyof SystemStatus["capabilities"]

/** What each capability means for the operator, both ways. */
const CAPABILITIES: { key: CapabilityKey; label: string; yes: string; no: string }[] = [
  { key: "folders", label: "Folders", yes: "Listings group keys into folders.", no: "Listings are flat: this driver does not report folders." },
  { key: "presign", label: "Presigned links", yes: "Share links can be offered where no middleware applies.", no: "No share links: this driver cannot sign one." },
  { key: "multipart", label: "Multipart uploads", yes: "The driver accepts uploads in parts.", no: "No multipart uploads." },
  { key: "range", label: "Range reads", yes: "The driver can read part of an object.", no: "No range reads." },
  { key: "serverCopy", label: "Server-side copy", yes: "Copies stay inside the backend.", no: "No server-side copy." },
  { key: "versioning", label: "Versioning", yes: "The driver keeps object versions.", no: "No object versions." },
  { key: "lifecycle", label: "Lifecycle rules", yes: "The driver applies lifecycle rules.", no: "No lifecycle rules." },
  { key: "notification", label: "Change notifications", yes: "The driver reports changes as they happen.", no: "No change notifications." },
]

function protectionCaption(n: number): string {
  return `${n} ${n === 1 ? "protection" : "protections"}`
}

export const OverviewPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const status = useQuery<SystemStatus>("system.status", withStore(store, {}))

  return (
    <section className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="What this store's driver can do, and which protections are actually switched on."
        actions={<StorePicker />}
      />

      <QueryBoundary title="Store status" query={status} skeletonRows={6}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Driver</span>
              <span className="font-mono text-xs font-medium">{data.driver}</span>
              <HealthBadge ok={data.health.ok} />
              {data.health.error ? <span className="text-destructive">{data.health.error}</span> : null}
            </div>

            {data.routingNote ? (
              <Alert>
                <AlertTitle>Some keys go to other backends</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span>{data.routingNote}</span>
                  <TagList values={data.backends} label="other backends" />
                </AlertDescription>
              </Alert>
            ) : null}

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Protection</h2>
              <p className="text-sm text-muted-foreground">
                Configured is what the config asks for. Applied is what is registered now. Neither says how earlier writes were stored.
              </p>
              <ResourceTable<FlagStatus>
                columns={flagColumns}
                rows={data.flags}
                rowKey={(f) => f.name}
                caption={protectionCaption(data.flags.length)}
                emptyMessage="This store reports no protections."
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">What this driver can do</h2>
              <DescriptionList
                items={CAPABILITIES.map((c) => ({
                  term: c.label,
                  value: data.capabilities[c.key] ? c.yes : c.no,
                }))}
              />
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Configuration</h2>
              <DescriptionList
                items={[
                  {
                    term: "Default bucket",
                    value: data.config.defaultBucket ? (
                      <span className="font-mono text-xs">{data.config.defaultBucket}</span>
                    ) : (
                      <NoneCell label="default bucket" />
                    ),
                  },
                  { term: "Chunk size", value: <Bytes value={data.config.chunkSize} /> },
                  { term: "Stream pool", value: `${data.config.poolSize} streams at once` },
                  { term: "Upload limit", value: <Bytes value={data.config.maxUploadBytes} /> },
                  {
                    term: "ETags",
                    value: data.etagIsContentHash
                      ? "Change when the content changes."
                      : "Set by the driver. Two objects with the same ETag may hold different bytes.",
                  },
                  {
                    term: "Content links",
                    value:
                      data.contentSecret === "configured"
                        ? "Signed with the configured key."
                        : "Signed with a key generated at start. Links only work on the instance that made them, so set dashboard_content_secret when you run more than one.",
                  },
                ]}
              />
            </section>
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

- [ ] **Step 4: Register the page**

In `src/index.tsx`, import `HouseIcon` from `@forge-go/dashboard-kit/icons` and `OverviewPage` from `./pages/overview`, export `OverviewPage`, and set:

```tsx
  nav: [{ label: "Overview", to: "/", priority: -10, icon: <HouseIcon />, group: "Storage" }],
  routes: [{ path: "/", element: OverviewPage }],
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: PASS. `shows no object counts or storage totals` must pass for the right reason: if some copy legitimately contains the word "objects" (for example "Objects outside that scope"), narrow the assertion to stat labels and say so; the test seeds no such note.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-trove/src/pages/overview.tsx packages/plugin-trove/test/overview.test.tsx
git commit --only -m "feat(plugin-trove): add the overview page" -m "<body>" -- packages/plugin-trove/src/pages/overview.tsx packages/plugin-trove/src/index.tsx packages/plugin-trove/test/overview.test.tsx packages/plugin-trove/test/plugin.test.tsx
git show --stat HEAD
```

Body: the overview names the driver and its health, says what the driver cannot do, and compares each protection configured against applied, so a store with enable_encryption set says nothing is encrypted. It shows no counts, because no driver can produce one.

---

### Task 3: Buckets page

**Files:**
- Create: `packages/plugin-trove/src/pages/buckets.tsx`
- Modify: `packages/plugin-trove/src/index.tsx`
- Test: `packages/plugin-trove/test/buckets.test.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `BucketsList`, `BucketRow`, `useActiveStore`, `withStore`, `StorePicker` from Task 1.
- Produces: `BucketsPage`.

Bucket names render as plain mono text in this slice. Slice 4 adds the browser at `/buckets/:bucket` and turns each name into a link then; a link now would point at a route that does not exist yet.

- [ ] **Step 1: Write the failing tests**

`test/buckets.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { ContractError } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { BucketsPage } from "../src/pages/buckets"
import { setActiveStore } from "../src/store"
import { recordingCommandClient, recordingQueryClient, renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }
const LIST = {
  buckets: [
    { name: "assets", createdAt: "2026-09-20T10:00:00Z" },
    { name: "reports", createdAt: null },
  ],
  createdAtMeaning: "modified",
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("BucketsPage", () => {
  it("lists buckets with a live count, mono names and the right date header", async () => {
    renderPage(BucketsPage, stubClient({ "buckets.list": LIST, "stores.list": SINGLE }))
    expect((await screen.findByText("reports")).className).toContain("font-mono")
    expect(screen.getByText("2 buckets")).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Last modified" })).toBeTruthy()
    expect(within(rowFor("reports")).getByLabelText("no modified time")).toBeTruthy()
  })

  it("says Created where the driver reports creation times", async () => {
    renderPage(BucketsPage, stubClient({ "buckets.list": { ...LIST, createdAtMeaning: "created" }, "stores.list": SINGLE }))
    expect(await screen.findByRole("columnheader", { name: "Created" })).toBeTruthy()
  })

  it("counts zero and says what to do", async () => {
    renderPage(BucketsPage, stubClient({ "buckets.list": { buckets: [], createdAtMeaning: "created" }, "stores.list": SINGLE }))
    expect(await screen.findByText("0 buckets")).toBeTruthy()
    expect(screen.getByText(/No buckets in this store yet/)).toBeTruthy()
  })

  it("sends the picked store with the list", async () => {
    act(() => setActiveStore("archive"))
    const { client, sent } = recordingQueryClient({
      "buckets.list": LIST,
      "stores.list": { mode: "multi", stores: [{ name: "primary", driver: "local", isDefault: true }, { name: "archive", driver: "s3", isDefault: false }] },
    })
    renderPage(BucketsPage, client)
    await screen.findByText("reports")
    expect(sent.find((s) => s.intent === "buckets.list")?.params).toEqual({ store: "archive" })
  })

  it("creates a bucket with the name as typed", async () => {
    const { client, sent } = recordingCommandClient(
      { "buckets.list": LIST, "stores.list": SINGLE },
      { "buckets.create": { name: "logs" } },
    )
    renderPage(BucketsPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Create bucket" }))
    const dialog = await screen.findByRole("dialog")
    const create = within(dialog).getByRole("button", { name: "Create" }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "logs" } })
    fireEvent.click(create)
    await waitFor(() => expect(sent).toEqual([{ intent: "buckets.create", payload: { name: "logs" } }]))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("shows a create refusal inside the dialog", async () => {
    const client: ScopedClient = {
      ...stubClient({ "buckets.list": LIST, "stores.list": SINGLE }),
      command: async () => {
        throw new ContractError("CONFLICT", "a bucket with this name already exists")
      },
    } as ScopedClient
    renderPage(BucketsPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Create bucket" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "assets" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }))
    expect(await within(dialog).findByText("a bucket with this name already exists")).toBeTruthy()
  })

  it("keeps the delete dialog open and shows the refusal inside it", async () => {
    const client: ScopedClient = {
      ...stubClient({ "buckets.list": LIST, "stores.list": SINGLE }),
      command: async () => {
        throw new ContractError("CONFLICT", "This bucket still holds objects. Delete them first.")
      },
    } as ScopedClient
    renderPage(BucketsPage, client)
    fireEvent.click(within(rowFor("reports")).getByRole("button", { name: "Delete reports" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Only an empty bucket can be deleted/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByText("This bucket still holds objects. Delete them first.")).toBeTruthy()
    expect(screen.getByRole("dialog")).toBeTruthy()
  })

  it("deletes with the bucket name and closes", async () => {
    const { client, sent } = recordingCommandClient(
      { "buckets.list": LIST, "stores.list": SINGLE },
      { "buckets.delete": { name: "assets" } },
    )
    renderPage(BucketsPage, client)
    fireEvent.click(within(rowFor("assets")).getByRole("button", { name: "Delete assets" }))
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "buckets.delete", payload: { name: "assets" } }]))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })
})
```

Append to `test/plugin.test.tsx`:

```tsx
  it("puts Buckets in the Storage group at /buckets", () => {
    const buckets = trovePlugin.nav?.find((n) => n.label === "Buckets")
    expect(buckets?.to).toBe("/buckets")
    expect(buckets?.group).toBe("Storage")
    expect(trovePlugin.routes.map((r) => r.path)).toContain("/buckets")
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL.

- [ ] **Step 3: Write the page**

`src/pages/buckets.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@forge-go/dashboard-kit/components/dialog"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { BucketRow, BucketsList } from "../types"

function bucketCaption(n: number): string {
  return `${n} ${n === 1 ? "bucket" : "buckets"}`
}

function columnsFor(meaning: BucketsList["createdAtMeaning"]): Column<BucketRow>[] {
  const created = meaning === "created"
  return [
    { id: "name", header: "Name", className: "font-mono text-xs font-medium", cell: (b) => b.name },
    {
      id: "time",
      header: created ? "Created" : "Last modified",
      cell: (b) => <Timestamp value={b.createdAt ?? undefined} label={created ? "creation time" : "modified time"} />,
    },
  ]
}

export const BucketsPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const list = useQuery<BucketsList>("buckets.list", withStore(store, {}))
  const create = useCommand<{ name: string }>("buckets.create")
  const remove = useCommand<{ name: string }>("buckets.delete")
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  function openCreate() {
    create.reset()
    setCreating(true)
  }

  function openDelete(name: string) {
    remove.reset()
    setDeleting(name)
  }

  async function confirmDelete() {
    if (deleting === null) return
    const result = await remove.execute(withStore(store, { name: deleting }))
    // undefined means the client threw: the dialog stays open on its error.
    if (result === undefined) return
    setDeleting(null)
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Buckets"
        description="Buckets as the driver reports them."
        actions={
          <div className="flex items-center gap-2">
            <StorePicker />
            <Button onClick={openCreate}>Create bucket</Button>
          </div>
        }
      />

      <QueryBoundary title="Buckets" query={list} skeletonRows={5}>
        {(data) => (
          <ResourceTable<BucketRow>
            columns={columnsFor(data.createdAtMeaning)}
            rows={data.buckets}
            rowKey={(b) => b.name}
            caption={bucketCaption(data.buckets.length)}
            emptyMessage="No buckets in this store yet. Create one to start storing objects."
            rowActions={(b) => (
              <Button variant="ghost" size="sm" aria-label={`Delete ${b.name}`} onClick={() => openDelete(b.name)}>
                Delete
              </Button>
            )}
          />
        )}
      </QueryBoundary>

      {creating ? (
        <CreateBucketDialog store={store} create={create} onClose={() => setCreating(false)} />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && !remove.loading && setDeleting(null)}
        title={`Delete ${deleting ?? ""}?`}
        description={
          <span className="flex flex-col gap-2">
            <span>
              Only an empty bucket can be deleted. Trove refuses a bucket that still holds objects, and the CAS bucket while CAS is on.
            </span>
            <CommandAlert error={remove.error} title="Could not delete the bucket" />
          </span>
        }
        confirmLabel="Delete"
        pending={remove.loading}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  )
}

function CreateBucketDialog({
  store,
  create,
  onClose,
}: {
  store: string
  create: ReturnType<typeof useCommand<{ name: string }>>
  onClose: () => void
}) {
  const [name, setName] = useState("")
  const canSubmit = name.trim() !== "" && !create.loading

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const result = await create.execute(withStore(store, { name }))
    if (result === undefined) return
    onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !create.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create a bucket</DialogTitle>
            <DialogDescription>The driver decides which names it accepts.</DialogDescription>
          </DialogHeader>
          <CommandAlert error={create.error} title="Could not create the bucket" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bucket-name">Name</Label>
            <Input
              id="bucket-name"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={create.loading} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.loading ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

Check `Button` accepts `size="sm"` and `variant="ghost"` (kit `button.tsx`); use what exists. The `…` in "Creating…" is a single ellipsis character, not a dash; keep it as Vault does.

- [ ] **Step 4: Register the page**

In `src/index.tsx`: import `DatabaseIcon` and `BucketsPage`, export `BucketsPage`, add nav `{ label: "Buckets", to: "/buckets", priority: 0, icon: <DatabaseIcon />, group: "Storage" }` and route `{ path: "/buckets", element: BucketsPage }`.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-trove/src/pages/buckets.tsx packages/plugin-trove/test/buckets.test.tsx
git commit --only -m "feat(plugin-trove): add the buckets page" -m "<body>" -- packages/plugin-trove/src/pages/buckets.tsx packages/plugin-trove/src/index.tsx packages/plugin-trove/test/buckets.test.tsx packages/plugin-trove/test/plugin.test.tsx
git show --stat HEAD
```

---

### Task 4: Middleware page

**Files:**
- Create: `packages/plugin-trove/src/pages/middleware.tsx`
- Modify: `packages/plugin-trove/src/index.tsx`
- Test: `packages/plugin-trove/test/middleware.test.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `MiddlewareList`, `MiddlewareRegistration`, `useActiveStore`, `withStore`, `StorePicker`.
- Produces: `MiddlewarePage`.

- [ ] **Step 1: Write the failing tests**

`test/middleware.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { MiddlewarePage } from "../src/pages/middleware"
import { recordingQueryClient, renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }

function reg(over: Record<string, unknown> = {}) {
  return { name: "compress", direction: "readwrite", scope: "global", priority: 0, matchesWrite: null, matchesRead: null, ...over }
}

const LIST = {
  registrations: [reg(), reg({ name: "encrypt", scope: "bucket(reports)", priority: 10 })],
  warnings: [{ code: "bypass", message: "CAS, copy and streams move stored bytes without running any middleware." }],
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("MiddlewarePage", () => {
  it("lists registrations in run order with a live count", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText("2 registrations")).toBeTruthy()
    const rows = screen.getAllByRole("row").slice(1)
    expect(within(rows[0]!).getByText("compress")).toBeTruthy()
    expect(within(rows[1]!).getByText("encrypt")).toBeTruthy()
    expect(within(rowFor("encrypt")).getByText("bucket(reports)").className).toContain("font-mono")
  })

  it("shows every warning", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText(/move stored bytes without running any middleware/)).toBeTruthy()
  })

  it("says plainly when nothing is registered", async () => {
    renderPage(MiddlewarePage, stubClient({ "middleware.list": { registrations: [], warnings: [] }, "stores.list": SINGLE }))
    expect(await screen.findByText("0 registrations")).toBeTruthy()
    expect(screen.getByText(/Objects are stored as they arrive/)).toBeTruthy()
  })

  it("does not test until both bucket and key are filled", async () => {
    const { client, sent } = recordingQueryClient({ "middleware.list": LIST, "stores.list": SINGLE })
    renderPage(MiddlewarePage, client)
    await screen.findByText("2 registrations")
    const test = screen.getByRole("button", { name: "Test" }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "reports" } })
    expect(test.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "2026/q3.csv" } })
    expect(test.disabled).toBe(false)
    fireEvent.click(test)
    await waitFor(() =>
      expect(sent.map((s) => s.params)).toContainEqual({ bucket: "reports", key: "2026/q3.csv" }),
    )
    expect(sent.filter((s) => s.intent === "middleware.list").every((s) => {
      const p = s.params as Record<string, unknown>
      return ("bucket" in p) === ("key" in p)
    })).toBe(true)
  })

  it("shows whether each registration runs for the tested key", async () => {
    const tested = {
      registrations: [
        reg({ matchesWrite: true, matchesRead: true }),
        reg({ name: "encrypt", scope: "bucket(reports)", priority: 10, matchesWrite: false, matchesRead: false }),
      ],
      warnings: [],
    }
    renderPage(MiddlewarePage, stubClient({ "middleware.list": tested, "stores.list": SINGLE }))
    fireEvent.change(await screen.findByLabelText("Bucket"), { target: { value: "logs" } })
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "a.txt" } })
    fireEvent.click(screen.getByRole("button", { name: "Test" }))
    await waitFor(() => expect(within(rowFor("compress")).getAllByText("Runs")).toHaveLength(2))
    expect(within(rowFor("encrypt")).getAllByText("Skipped")).toHaveLength(2)
    expect(screen.getByText(/tested against logs\/a\.txt/)).toBeTruthy()
  })
})
```

Append to `test/plugin.test.tsx` the same shape of test for "Middleware" at "/middleware".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL.

- [ ] **Step 3: Write the page**

`src/pages/middleware.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType, FormEvent } from "react"
import { useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { Label } from "@forge-go/dashboard-kit/components/label"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { MiddlewareList, MiddlewareRegistration } from "../types"

type Row = MiddlewareRegistration & { order: number }

function runs(value: boolean | null, what: string) {
  if (value === null) return <NoneCell label={what} />
  return value ? "Runs" : "Skipped"
}

function columnsFor(tested: boolean): Column<Row>[] {
  const base: Column<Row>[] = [
    { id: "order", header: "Order", className: "font-mono text-xs", cell: (r) => r.order },
    { id: "name", header: "Middleware", className: "font-mono text-xs font-medium", cell: (r) => r.name },
    { id: "direction", header: "Direction", cell: (r) => r.direction },
    { id: "scope", header: "Scope", className: "font-mono text-xs", cell: (r) => r.scope },
    { id: "priority", header: "Priority", className: "font-mono text-xs", cell: (r) => r.priority },
  ]
  if (!tested) return base
  return [
    ...base,
    { id: "write", header: "On write", cell: (r) => runs(r.matchesWrite, "write result") },
    { id: "read", header: "On read", cell: (r) => runs(r.matchesRead, "read result") },
  ]
}

function caption(n: number, tested: { bucket: string; key: string } | null): string {
  const count = `${n} ${n === 1 ? "registration" : "registrations"}`
  return tested ? `${count}, tested against ${tested.bucket}/${tested.key}` : count
}

export const MiddlewarePage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const [bucket, setBucket] = useState("")
  const [key, setKey] = useState("")
  const [tested, setTested] = useState<{ bucket: string; key: string } | null>(null)
  const list = useQuery<MiddlewareList>("middleware.list", withStore(store, tested ? { ...tested } : {}))

  const canTest = bucket.trim() !== "" && key !== ""

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canTest) return
    setTested({ bucket: bucket.trim(), key })
  }

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Middleware"
        description="Every middleware registered on this store, in the order it runs. This is the configuration now. Trove records nothing about how an existing object was written."
        actions={<StorePicker />}
      />

      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mw-bucket">Bucket</Label>
          <Input id="mw-bucket" className="font-mono" autoComplete="off" spellCheck={false} value={bucket} onChange={(e) => setBucket(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mw-key">Key</Label>
          <Input id="mw-key" className="font-mono" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <Button type="submit" disabled={!canTest}>
          Test
        </Button>
        {tested ? (
          <Button type="button" variant="outline" onClick={() => setTested(null)}>
            Clear test
          </Button>
        ) : null}
      </form>

      <QueryBoundary title="Middleware" query={list} skeletonRows={4}>
        {(data) => (
          <>
            {data.warnings.map((w) => (
              <Alert key={w.code}>
                <AlertDescription>{w.message}</AlertDescription>
              </Alert>
            ))}
            <ResourceTable<Row>
              columns={columnsFor(tested !== null)}
              rows={data.registrations.map((r, i) => ({ ...r, order: i + 1 }))}
              rowKey={(r) => `${r.order}`}
              caption={caption(data.registrations.length, tested)}
              emptyMessage="No middleware is registered for this store. Objects are stored as they arrive."
            />
          </>
        )}
      </QueryBoundary>
    </section>
  )
}
```

A key may be made of spaces (that is a valid key), so `key` is not trimmed; the bucket is.

- [ ] **Step 4: Register the page**

In `src/index.tsx`: `LayersIcon`, `MiddlewarePage`, nav `{ label: "Middleware", to: "/middleware", priority: 10, icon: <LayersIcon />, group: "Storage" }`, route `{ path: "/middleware", element: MiddlewarePage }`.

- [ ] **Step 5: Run the tests, typecheck and lint, then commit**

Run the three checks as in Task 3, then:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-trove/src/pages/middleware.tsx packages/plugin-trove/test/middleware.test.tsx
git commit --only -m "feat(plugin-trove): add the middleware page with a key test" -m "<body>" -- packages/plugin-trove/src/pages/middleware.tsx packages/plugin-trove/src/index.tsx packages/plugin-trove/test/middleware.test.tsx packages/plugin-trove/test/plugin.test.tsx
git show --stat HEAD
```

---

### Task 5: CAS page

**Files:**
- Create: `packages/plugin-trove/src/pages/cas.tsx`
- Modify: `packages/plugin-trove/src/index.tsx`
- Test: `packages/plugin-trove/test/cas.test.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `CasStatus`, `CasList`, `CasEntry`, `CasGCResult`, `CasStateBadge`, `Bytes`, `formatBytes`, `useActiveStore`, `withStore`, `StorePicker`.
- Produces: `CasPage`.

The spec's "Lookup by hash" is dropped: the contract has no lookup intent (slice 2 shipped `cas.list`, `cas.pin`, `cas.unpin`, `cas.gc` and `cas.status`), and filtering only the loaded page would be a partial search shown as a complete one. Task 9 records this in the spec.

- [ ] **Step 1: Write the failing tests**

`test/cas.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import { CasPage } from "../src/pages/cas"
import { recordingCommandClient, recordingQueryClient, renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }
const ON = { enabled: true, algorithm: "sha256", bucket: "cas", index: "memory", resetsOnRestart: true, releaseSupported: false }
const OFF = { enabled: false, algorithm: null, bucket: null, index: null, resetsOnRestart: false, releaseSupported: false }
const A = "sha256:aaaa1111"
const B = "sha256:bbbb2222"
const ORPHAN = "sha256:dead0000"
const PAGE1 = {
  entries: [
    { hash: A, storedSize: 4812, lastModified: "2026-09-29T08:00:00Z", indexed: true, refCount: 2, pinned: false },
    { hash: B, storedSize: 120, lastModified: null, indexed: true, refCount: 1, pinned: true },
    { hash: ORPHAN, storedSize: 9, lastModified: null, indexed: false, refCount: null, pinned: null },
  ],
  nextCursor: "Y3Vyc29yMg",
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("CasPage", () => {
  it("does not ask for cas.list when CAS is off", async () => {
    const { client, sent } = recordingQueryClient({ "cas.status": OFF, "stores.list": SINGLE })
    renderPage(CasPage, client)
    expect(await screen.findByText(/CAS is not enabled on this store/)).toBeTruthy()
    expect(sent.some((s) => s.intent === "cas.list")).toBe(false)
  })

  it("states the index ceiling before the table", async () => {
    renderPage(CasPage, stubClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE }))
    expect(await screen.findByText(/forgets every reference count and pin/)).toBeTruthy()
    expect(screen.getByText(/never finds anything to collect/)).toBeTruthy()
  })

  it("shows each entry's state, refs and size, with null refs as none", async () => {
    renderPage(CasPage, stubClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE }))
    expect((await screen.findByText(A)).className).toContain("font-mono")
    expect(within(rowFor(A)).getByText("Indexed")).toBeTruthy()
    expect(within(rowFor(B)).getByText("Pinned")).toBeTruthy()
    expect(within(rowFor(ORPHAN)).getByText("Not indexed")).toBeTruthy()
    expect(within(rowFor(ORPHAN)).getByLabelText("no reference count")).toBeTruthy()
    expect(within(rowFor(A)).getByText("4,812 B")).toBeTruthy()
    expect(screen.getByText("3 on this page, more after it")).toBeTruthy()
  })

  it("pages with the cursor it was given", async () => {
    const { client, sent } = recordingQueryClient({ "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE })
    renderPage(CasPage, client)
    await screen.findByText(A)
    fireEvent.click(screen.getByRole("button", { name: "Next page" }))
    await waitFor(() =>
      expect(sent.filter((s) => s.intent === "cas.list").map((s) => s.params)).toContainEqual({ cursor: "Y3Vyc29yMg", limit: 100 }),
    )
  })

  it("offers pin and unpin only on indexed rows", async () => {
    const { client, sent } = recordingCommandClient(
      { "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE },
      { "cas.pin": PAGE1.entries[0], "cas.unpin": PAGE1.entries[1] },
    )
    renderPage(CasPage, client)
    await screen.findByText(A)
    expect(within(rowFor(ORPHAN)).queryByRole("button")).toBeNull()
    fireEvent.click(within(rowFor(A)).getByRole("button", { name: `Pin ${A}` }))
    fireEvent.click(within(rowFor(B)).getByRole("button", { name: `Unpin ${B}` }))
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "cas.pin", payload: { hash: A } },
        { intent: "cas.unpin", payload: { hash: B } },
      ]),
    )
  })

  it("runs GC behind a confirmation and reports what it did", async () => {
    const { client, sent } = recordingCommandClient(
      { "cas.status": ON, "cas.list": PAGE1, "stores.list": SINGLE },
      { "cas.gc": { scanned: 0, deleted: 0, freedBytes: 0, errors: 0 } },
    )
    renderPage(CasPage, client)
    fireEvent.click(await screen.findByRole("button", { name: "Run garbage collection" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/Blobs the index does not know are never touched/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "cas.gc", payload: {} }]))
    expect(await screen.findByText(/Checked 0 index entries, deleted 0, freed 0 B/)).toBeTruthy()
  })
})
```

Append the plugin test for "CAS" at "/cas".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL.

- [ ] **Step 3: Write the page**

`src/pages/cas.tsx`:

```tsx
import { useState } from "react"
import type { ComponentType } from "react"
import { useCommand, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { ConfirmDialog } from "@forge-go/dashboard-kit/components/confirm-dialog"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { CommandAlert, QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { CasStateBadge } from "../badges"
import { Bytes } from "../components/bytes"
import { StorePicker } from "../components/store-picker"
import { formatBytes } from "../format"
import { useActiveStore, withStore } from "../store"
import type { CasEntry, CasGCResult, CasList, CasStatus } from "../types"

const PAGE_SIZE = 100

export const CasPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const status = useQuery<CasStatus>("cas.status", withStore(store, {}))

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="CAS"
        description="Content-addressable storage: blobs stored under their hash, with a reference count per hash."
        actions={<StorePicker />}
      />
      <QueryBoundary title="CAS status" query={status} skeletonRows={3}>
        {(data) =>
          data.enabled ? (
            <>
              <CasCeiling status={data} />
              {/* Keyed by store so a switch starts from the first page. */}
              <CasEntries key={store} store={store} />
            </>
          ) : (
            <EmptyState title="CAS is not enabled on this store." />
          )
        }
      </QueryBoundary>
    </section>
  )
}

function CasCeiling({ status }: { status: CasStatus }) {
  return (
    <section className="flex flex-col gap-2">
      <DescriptionList
        items={[
          { term: "Algorithm", value: status.algorithm ? <span className="font-mono text-xs">{status.algorithm}</span> : <NoneCell label="algorithm" /> },
          { term: "Bucket", value: status.bucket ? <span className="font-mono text-xs">{status.bucket}</span> : <NoneCell label="bucket" /> },
          { term: "Index", value: status.index === "memory" ? "In memory" : status.index ?? <NoneCell label="index" /> },
        ]}
      />
      {status.resetsOnRestart ? (
        <p className="text-sm text-muted-foreground">
          The index lives in this process's memory. A restart forgets every reference count and pin, and blobs already in the bucket then show as not indexed.
        </p>
      ) : null}
      {!status.releaseSupported ? (
        <p className="text-sm text-muted-foreground">
          Nothing in CAS lowers a reference count, so garbage collection never finds anything to collect.
        </p>
      ) : null}
    </section>
  )
}

function entriesCaption(n: number, more: boolean): string {
  if (more) return `${n} on this page, more after it`
  return `${n} ${n === 1 ? "entry" : "entries"}`
}

function CasEntries({ store }: { store: string }) {
  const [cursors, setCursors] = useState<string[]>([])
  const cursor = cursors.at(-1) ?? ""
  const list = useQuery<CasList>("cas.list", withStore(store, cursor ? { cursor, limit: PAGE_SIZE } : { limit: PAGE_SIZE }))
  const pin = useCommand<CasEntry>("cas.pin")
  const unpin = useCommand<CasEntry>("cas.unpin")
  const gc = useCommand<CasGCResult>("cas.gc")
  const [confirmingGC, setConfirmingGC] = useState(false)
  const [gcResult, setGCResult] = useState<CasGCResult | null>(null)

  const columns: Column<CasEntry>[] = [
    { id: "hash", header: "Hash", className: "font-mono text-xs font-medium", cell: (e) => e.hash },
    { id: "size", header: "Stored size", cell: (e) => <Bytes value={e.storedSize} /> },
    {
      id: "refs",
      header: "References",
      className: "font-mono text-xs",
      cell: (e) => (e.refCount === null ? <NoneCell label="reference count" /> : e.refCount),
    },
    { id: "state", header: "State", cell: (e) => <CasStateBadge entry={e} /> },
    { id: "modified", header: "Last modified", cell: (e) => <Timestamp value={e.lastModified ?? undefined} label="modified time" /> },
  ]

  function openGC() {
    gc.reset()
    setGCResult(null)
    setConfirmingGC(true)
  }

  async function runGC() {
    const result = await gc.execute(withStore(store, {}))
    if (result === undefined) return
    setGCResult(result)
    setConfirmingGC(false)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Entries</h2>
        <Button variant="outline" onClick={openGC}>
          Run garbage collection
        </Button>
      </div>
      {gcResult ? (
        <p className="text-sm">
          {`Checked ${gcResult.scanned} index entries, deleted ${gcResult.deleted}, freed ${formatBytes(gcResult.freedBytes)}.`}
          {gcResult.errors > 0 ? ` ${gcResult.errors} could not be deleted.` : ""}
        </p>
      ) : null}
      <CommandAlert error={pin.error} title="Could not pin" />
      <CommandAlert error={unpin.error} title="Could not unpin" />

      <QueryBoundary title="CAS entries" query={list} skeletonRows={5}>
        {(data) => (
          <>
            <ResourceTable<CasEntry>
              columns={columns}
              rows={data.entries}
              rowKey={(e) => e.hash}
              caption={entriesCaption(data.entries.length, data.nextCursor !== null)}
              emptyMessage={
                data.nextCursor !== null
                  ? "Nothing on this page, but the driver has more to list."
                  : cursors.length > 0
                    ? "No more entries."
                    : "No CAS content stored yet."
              }
              rowActions={(e) =>
                !e.indexed ? null : e.pinned ? (
                  <Button variant="ghost" size="sm" aria-label={`Unpin ${e.hash}`} disabled={unpin.loading} onClick={() => void unpin.execute(withStore(store, { hash: e.hash }))}>
                    Unpin
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" aria-label={`Pin ${e.hash}`} disabled={pin.loading} onClick={() => void pin.execute(withStore(store, { hash: e.hash }))}>
                    Pin
                  </Button>
                )
              }
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={cursors.length === 0} onClick={() => setCursors((c) => c.slice(0, -1))}>
                Previous page
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.nextCursor === null}
                onClick={() => data.nextCursor !== null && setCursors((c) => [...c, data.nextCursor as string])}
              >
                Next page
              </Button>
            </div>
          </>
        )}
      </QueryBoundary>

      <ConfirmDialog
        open={confirmingGC}
        onOpenChange={(open) => !open && !gc.loading && setConfirmingGC(false)}
        title="Run garbage collection?"
        description={
          <span className="flex flex-col gap-2">
            <span>
              It deletes indexed entries that have no references and are not pinned. Nothing lowers a reference count today, so expect it to delete nothing. Blobs the index does not know are never touched.
            </span>
            <CommandAlert error={gc.error} title="Garbage collection failed" />
          </span>
        }
        confirmLabel="Run"
        destructive={false}
        pending={gc.loading}
        onConfirm={() => void runGC()}
      />
    </section>
  )
}
```

If a row action returning `null` breaks `ResourceTable`'s layout or typing, render `<NoneCell label="actions" />` instead for not-indexed rows and update the test's `queryByRole("button")` expectation accordingly (it stays: NoneCell is not a button).

- [ ] **Step 4: Register the page**

`FingerprintIcon`, `CasPage`, nav `{ label: "CAS", to: "/cas", priority: 20, icon: <FingerprintIcon />, group: "Storage" }`, route `{ path: "/cas", element: CasPage }`.

- [ ] **Step 5: Run the checks and commit**

Run the three checks, then:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-trove/src/pages/cas.tsx packages/plugin-trove/test/cas.test.tsx
git commit --only -m "feat(plugin-trove): add the CAS page with its index ceiling stated" -m "<body>" -- packages/plugin-trove/src/pages/cas.tsx packages/plugin-trove/src/index.tsx packages/plugin-trove/test/cas.test.tsx packages/plugin-trove/test/plugin.test.tsx
git show --stat HEAD
```

---

### Task 6: Transfers page

**Files:**
- Create: `packages/plugin-trove/src/pages/transfers.tsx`
- Modify: `packages/plugin-trove/src/index.tsx`
- Test: `packages/plugin-trove/test/transfers.test.tsx`, `test/plugin.test.tsx`

**Interfaces:**
- Consumes: `StreamsList`, `StreamRow`, `StreamStateBadge`, `Bytes`, `useActiveStore`, `withStore`, `StorePicker`; `usePoll` from `@forge-go/dashboard-plugin`.
- Produces: `TransfersPage`.

- [ ] **Step 1: Write the failing tests**

`test/transfers.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { screen, within } from "@testing-library/react"
import { TransfersPage } from "../src/pages/transfers"
import { renderPage, stubClient } from "./harness"

const SINGLE = { mode: "single", stores: [{ name: "default", driver: "local", isDefault: true }] }
const LIST = {
  streams: [
    { id: "str_01", direction: "upload", bucket: "reports", key: "2026/09/big.csv", state: "active", offset: 3145728, totalSize: 10485760 },
    { id: "str_02", direction: "download", bucket: "assets", key: "logo.png", state: "paused", offset: 2048, totalSize: null },
  ],
  active: 2,
  max: 16,
}

function rowFor(text: string): HTMLElement {
  return screen.getAllByRole("row").find((r) => within(r).queryByText(text))!
}

describe("TransfersPage", () => {
  it("says the streams are not saved", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": LIST, "stores.list": SINGLE }))
    expect(await screen.findByText(/not saved and are lost on restart/)).toBeTruthy()
  })

  it("lists each stream with its state, target and progress", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": LIST, "stores.list": SINGLE }))
    expect((await screen.findByText("reports/2026/09/big.csv")).className).toContain("font-mono")
    const up = rowFor("reports/2026/09/big.csv")
    expect(within(up).getByText("active")).toBeTruthy()
    expect(within(up).getByText("3,145,728 B")).toBeTruthy()
    expect(within(up).getByText("10,485,760 B")).toBeTruthy()
    expect(within(rowFor("assets/logo.png")).getByLabelText("no total size")).toBeTruthy()
    expect(screen.getByText("2 open streams, 16 allowed")).toBeTruthy()
  })

  it("counts zero and says so", async () => {
    renderPage(TransfersPage, stubClient({ "streams.list": { streams: [], active: 0, max: 16 }, "stores.list": SINGLE }))
    expect(await screen.findByText("0 open streams, 16 allowed")).toBeTruthy()
    expect(screen.getByText("No streams open.")).toBeTruthy()
  })
})
```

Append the plugin test for "Transfers" at "/transfers".

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL.

- [ ] **Step 3: Write the page**

`src/pages/transfers.tsx`:

```tsx
import type { ComponentType } from "react"
import { usePoll, useQuery } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { QueryBoundary } from "@forge-go/dashboard-kit/components/query-boundary"
import { ResourceTable, type Column } from "@forge-go/dashboard-kit/components/resource-table"
import { StreamStateBadge } from "../badges"
import { Bytes } from "../components/bytes"
import { StorePicker } from "../components/store-picker"
import { useActiveStore, withStore } from "../store"
import type { StreamRow, StreamsList } from "../types"

const POLL_MS = 5000

const columns: Column<StreamRow>[] = [
  { id: "target", header: "Object", className: "font-mono text-xs font-medium", cell: (s) => `${s.bucket}/${s.key}` },
  { id: "direction", header: "Direction", cell: (s) => s.direction },
  { id: "state", header: "State", cell: (s) => <StreamStateBadge state={s.state} /> },
  { id: "offset", header: "Transferred", cell: (s) => <Bytes value={s.offset} /> },
  {
    id: "total",
    header: "Expected size",
    cell: (s) => (s.totalSize === null ? <NoneCell label="total size" /> : <Bytes value={s.totalSize} />),
  },
]

function caption(n: number, max: number): string {
  return `${n} open ${n === 1 ? "stream" : "streams"}, ${max} allowed`
}

export const TransfersPage: ComponentType<PluginPageProps> = () => {
  const store = useActiveStore()
  const list = useQuery<StreamsList>("streams.list", withStore(store, {}))
  usePoll(list.refetch, POLL_MS)

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title="Transfers"
        description="Streams open in this process. They are not saved and are lost on restart."
        actions={<StorePicker />}
      />
      <QueryBoundary title="Transfers" query={list} skeletonRows={3}>
        {(data) => (
          <ResourceTable<StreamRow>
            columns={columns}
            rows={data.streams}
            rowKey={(s) => s.id}
            caption={caption(data.streams.length, data.max)}
            emptyMessage="No streams open."
          />
        )}
      </QueryBoundary>
    </section>
  )
}
```

Check `usePoll`'s signature in `packages/plugin/src/poll.ts` (`usePoll(refetch, intervalMs)`), and that it does not break the tests (it only sets an interval; if fake timers are needed, they are not, because the tests assert on the first render).

- [ ] **Step 4: Register the page**

`ArrowLeftRightIcon`, `TransfersPage`, nav `{ label: "Transfers", to: "/transfers", priority: 30, icon: <ArrowLeftRightIcon />, group: "Storage" }`, route `{ path: "/transfers", element: TransfersPage }`.

- [ ] **Step 5: Run the checks and commit**

Run the three checks, then:

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
git add packages/plugin-trove/src/pages/transfers.tsx packages/plugin-trove/test/transfers.test.tsx
git commit --only -m "feat(plugin-trove): add the transfers page" -m "<body>" -- packages/plugin-trove/src/pages/transfers.tsx packages/plugin-trove/src/index.tsx packages/plugin-trove/test/transfers.test.tsx packages/plugin-trove/test/plugin.test.tsx
git show --stat HEAD
```

---

### Task 7: Fixtures for all 20 intents

**Files:**
- Create: `packages/fixture-server/trove-fixtures.mjs`
- Modify: `packages/fixture-server/server.mjs` (one import, one `CONTRIBUTORS` entry, one reset call)
- Modify: `packages/fixture-server/verify.mjs` (trove `INPUT` entries, one `EXPECT_FAILURE` entry if needed, trove spot checks)

**Interfaces:**
- Produces: `createTroveHandlers(FixtureError)` returning `{ [intent]: { kind, invalidates?, handler(input) } }`, and `resetTrove()`.

The fixture models the contract slice 2 SHIPPED (read the handler files in `/Users/rexraphael/Work/xraph/forgery/trove/extension/contract/` when a rule below is unclear; the Go rule wins). It is multi-store: `primary` (driver `local`, the default) and `archive` (driver `s3`, presign-capable, with a named backend `cold`, so its routing note shows).

- [ ] **Step 1: Write `trove-fixtures.mjs`**

```js
// trove-fixtures.mjs: in-memory state and intent handlers for the trove
// contributor (packages/plugin-trove), kept out of server.mjs like
// vault-fixtures.mjs.
//
// Mirrors trove/extension/contract as slice 2 shipped it: handlers_*.go,
// errors.go, cursor.go, project.go. Field names are the Go JSON tags. It is
// multi-store: "primary" on the local driver (the default) and "archive" on
// s3, which can presign and routes some keys to a backend named "cold".
//
// Like the Go contract, nothing here reads a metadata store: buckets, objects,
// the CAS index and streams are what the drivers and engines would report.
// Content tickets are unsigned here; slice 4 gives the fixture its content
// routes and checks them there.
//
// server.mjs hands in its FixtureError class so refusals carry their real
// status and code (a class declared here would not pass instanceof there).

const CONTENT_PATH = "/dashboard/trove/content"
const MAX_UPLOAD = 64 * 1024 * 1024
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 1000
const MAX_PREVIEW = 256 * 1024
const ENC_NOT_APPLIED =
  "enable_encryption is set, but the extension never registers the encrypt middleware. Nothing is encrypted."
const NO_SCAN = "No scan middleware is registered, so uploads are not scanned."
const ROUTING_NOTE =
  "This store routes some keys to other backends. Listings, bucket operations and health describe the default backend only."
const CAS_GUARD = (b) =>
  `CAS manages the ${b} bucket. Changing its objects here would leave the CAS index pointing at the wrong content.`

const NOW = Date.parse("2026-09-30T12:00:00Z")
function ago(minutes) {
  return new Date(NOW - minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z")
}
function hex(seed, n = 64) {
  let out = ""
  while (out.length < n) out += seed
  return out.slice(0, n)
}
const HASH_A = `sha256:${hex("a1")}`
const HASH_B = `sha256:${hex("b2")}`
const HASH_ORPHAN = `sha256:${hex("de")}`

function obj(size, minutes, extra = {}) {
  return {
    storedSize: size,
    etag: extra.etag ?? `${size.toString(16)}-${(NOW - minutes * 60_000).toString(16)}`,
    lastModified: ago(minutes),
    contentType: extra.contentType ?? null,
    storageClass: extra.storageClass ?? null,
    versionId: extra.versionId ?? null,
    metadata: extra.metadata ?? null,
  }
}

function seed() {
  return {
    primary: {
      driver: "local",
      isDefault: true,
      healthy: true,
      capabilities: { multipart: false, presign: false, range: false, serverCopy: false, versioning: false, notification: false, lifecycle: false, folders: true },
      config: { defaultBucket: "reports", chunkSize: 8388608, poolSize: 16 },
      etagIsContentHash: false,
      createdAtMeaning: "modified",
      backends: [],
      configured: { encryption: true, compression: true, cas: true },
      registrations: [{ name: "compress", direction: "readwrite", scope: "global", priority: 0 }],
      cas: { algorithm: "sha256", bucket: "cas" },
      index: new Map([
        [HASH_A, { refCount: 2, pinned: false }],
        [HASH_B, { refCount: 1, pinned: true }],
      ]),
      streams: [
        { id: "str_01j9k4m2e7t8x3q5r6v0w1y2za", direction: "upload", bucket: "reports", key: "2026/09/big.csv", state: "active", offset: 3145728, totalSize: 10485760 },
        { id: "str_01j9k4m2e7t8x3q5r6v0w1y2zb", direction: "download", bucket: "assets", key: "logo.png", state: "paused", offset: 2048, totalSize: null },
      ],
      buckets: new Map([
        ["reports", { createdAt: ago(60 * 24 * 30), objects: new Map([
          ["2026/08/summary.json", obj(3901, 60 * 24 * 31, { contentType: "application/json" })],
          ["2026/09/raw.bin", obj(1048576, 60 * 5)],
          ["2026/09/summary.json", obj(4812, 2, { contentType: "application/json", metadata: { owner: "ops" } })],
          ["q3 résumé #1.pdf", obj(88213, 60 * 24, { contentType: "application/pdf" })],
          ["readme.txt", obj(1204, 60 * 2, { contentType: "text/plain" })],
        ]) }],
        ["assets", { createdAt: ago(60 * 24 * 20), objects: new Map([
          ["logo.png", obj(20480, 60 * 24 * 3, { contentType: "image/png" })],
        ]) }],
        ["empty", { createdAt: ago(60 * 24 * 2), objects: new Map() }],
        ["cas", { createdAt: ago(60 * 24 * 10), objects: new Map([
          [HASH_A, obj(4812, 60 * 24)],
          [HASH_B, obj(120, 60 * 12)],
          [HASH_ORPHAN, obj(9, 60 * 48)],
        ]) }],
      ]),
    },
    archive: {
      driver: "s3",
      isDefault: false,
      healthy: true,
      capabilities: { multipart: true, presign: true, range: true, serverCopy: false, versioning: false, notification: false, lifecycle: false, folders: true },
      config: { defaultBucket: null, chunkSize: 8388608, poolSize: 16 },
      etagIsContentHash: true,
      createdAtMeaning: "created",
      backends: ["cold"],
      configured: { encryption: false, compression: false, cas: false },
      registrations: [],
      cas: null,
      index: new Map(),
      streams: [],
      buckets: new Map([
        ["backups", { createdAt: ago(60 * 24 * 90), objects: new Map([
          ["db/2026-09-29.dump", obj(52428800, 60 * 30, { contentType: "application/octet-stream", storageClass: "STANDARD", etag: "9b2cf535f27731c974343645a3985328" })],
          ["db/2026-09-30.dump", obj(52430112, 60 * 6, { contentType: "application/octet-stream", storageClass: "STANDARD", etag: "6f5902ac237024bdd0c176cb93063dc4" })],
        ]) }],
      ]),
    },
  }
}

let state = seed()

export function resetTrove() {
  state = seed()
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64url")

export function createTroveHandlers(FixtureError) {
  const badRequest = (m, details) => new FixtureError(400, "BAD_REQUEST", m, details)
  const notFound = (m) => new FixtureError(404, "NOT_FOUND", m)
  const conflict = (m, details) => new FixtureError(409, "CONFLICT", m, details)
  const unavailable = (m) => new FixtureError(503, "UNAVAILABLE", m)

  /** Stores.Resolve: absent is the default, blank refuses, unknown is not found. */
  function store(input) {
    const raw = input?.store
    if (raw === undefined || raw === null || raw === "") return { name: "primary", s: state.primary }
    if (typeof raw !== "string" || raw.trim() === "") throw badRequest("store is blank")
    if (!(raw in state)) throw notFound(`no store named "${raw}"`)
    return { name: raw, s: state[raw] }
  }

  function requireName(field, value) {
    if (typeof value !== "string" || value.trim() === "") throw badRequest(`${field} is required`)
    return value
  }

  function requireKey(value) {
    if (typeof value !== "string" || value === "") throw badRequest("key is required")
    return value
  }

  function bucketOf(s, name) {
    const b = s.buckets.get(name)
    if (!b) throw notFound("bucket not found")
    return b
  }

  function objectOf(s, bucket, key) {
    const o = bucketOf(s, bucket).objects.get(key)
    if (!o) throw notFound("object not found")
    return o
  }

  function row(key, o) {
    return { key, storedSize: o.storedSize, etag: o.etag, lastModified: o.lastModified, contentType: o.contentType, storageClass: o.storageClass }
  }

  function detail(key, o) {
    return { ...row(key, o), versionId: o.versionId, metadata: o.metadata }
  }

  function decodeCursor(c) {
    if (c === undefined || c === null || c === "") return ""
    if (typeof c !== "string" || !/^[A-Za-z0-9_-]+$/.test(c)) {
      throw badRequest("cursor is malformed. Pass back nextCursor exactly as you received it.")
    }
    return Buffer.from(c, "base64url").toString("utf8")
  }

  function clampLimit(raw) {
    const n = typeof raw === "number" && Number.isFinite(raw) ? Math.trunc(raw) : 0
    if (n <= 0) return DEFAULT_LIMIT
    return Math.min(n, MAX_LIMIT)
  }

  /** driver.PageKeys: fold by delimiter, skip through the cursor, count both. */
  function pageKeys(sorted, { prefix, delimiter, cursor, limit }) {
    const keys = [], prefixes = []
    let emitted = 0, last = "", next = ""
    for (const key of sorted) {
      if (!key.startsWith(prefix)) continue
      let item = key, isPrefix = false
      if (delimiter !== "") {
        const rest = key.slice(prefix.length)
        const i = rest.indexOf(delimiter)
        if (i >= 0) { item = prefix + rest.slice(0, i + delimiter.length); isPrefix = true }
      }
      if (cursor !== "" && item <= cursor) continue
      if (isPrefix && emitted > 0 && item === last) continue
      if (emitted === limit) { next = last; break }
      if (isPrefix) prefixes.push(item); else keys.push(key)
      last = item
      emitted += 1
    }
    return { keys, prefixes, next }
  }

  function matchingRows(s) {
    // Every fixture registration has a global scope, so it matches every key.
    return s.registrations.map((r) => ({ name: r.name, direction: r.direction, scope: r.scope, priority: r.priority }))
  }

  function presignOf(s, rows) {
    if (!s.capabilities.presign) return { available: false, reason: "This driver cannot create presigned links." }
    if (rows.length > 0) {
      return { available: false, reason: `Middleware applies to this key (${rows.map((r) => r.name).join(", ")}). A presigned link would skip it and return the stored bytes.` }
    }
    return { available: true, reason: null }
  }

  function refuseCAS(s, bucket) {
    if (s.cas && s.cas.bucket === bucket) throw conflict(CAS_GUARD(bucket))
  }

  function ticket(fields, ttlSeconds) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    return { token: b64(JSON.stringify({ ...fields, e: expires })), expiresAt: new Date(expires * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") }
  }

  function flags(s) {
    const has = (n) => s.registrations.some((r) => r.name === n)
    const f = (name, configured, applied, note) => ({ name, configured, applied, note })
    return [
      f("encryption", s.configured.encryption, has("encrypt"), s.configured.encryption && !has("encrypt") ? ENC_NOT_APPLIED : null),
      f("compression", s.configured.compression, has("compress"), s.configured.compression && !has("compress") ? "enable_compression is set, but no compress middleware is registered." : null),
      f("scanning", has("scan"), has("scan"), has("scan") ? null : NO_SCAN),
      f("cas", s.configured.cas, s.cas !== null, s.configured.cas && s.cas === null ? "enable_cas is set, but this store has no CAS engine." : null),
    ]
  }

  function requireCAS(s) {
    if (!s.cas) throw unavailable("CAS is not enabled on this store.")
    return s.cas
  }

  return {
    "system.status": {
      kind: "query",
      handler: (input) => {
        const { name, s } = store(input)
        return {
          store: name,
          driver: s.driver,
          health: s.healthy ? { ok: true, error: null } : { ok: false, error: "The driver did not answer a ping." },
          capabilities: { ...s.capabilities },
          config: { ...s.config, maxUploadBytes: MAX_UPLOAD },
          flags: flags(s),
          etagIsContentHash: s.etagIsContentHash,
          contentSecret: "per-process",
          backends: [...s.backends],
          routingNote: s.backends.length > 0 ? ROUTING_NOTE : null,
        }
      },
    },
    "stores.list": {
      kind: "query",
      handler: () => ({
        mode: "multi",
        stores: Object.entries(state).map(([name, s]) => ({ name, driver: s.driver, isDefault: s.isDefault })),
      }),
    },
    "buckets.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const buckets = [...s.buckets.entries()]
          .map(([name, b]) => ({ name, createdAt: b.createdAt }))
          .sort((a, b) => (a.name < b.name ? -1 : 1))
        return { buckets, createdAtMeaning: s.createdAtMeaning }
      },
    },
    "buckets.create": {
      kind: "command",
      invalidates: ["buckets.list"],
      handler: (input) => {
        const name = requireName("name", input?.name)
        const { s } = store(input)
        if (s.buckets.has(name)) throw conflict("a bucket with this name already exists")
        s.buckets.set(name, { createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), objects: new Map() })
        return { name }
      },
    },
    "buckets.delete": {
      kind: "command",
      invalidates: ["buckets.list", "objects.list"],
      handler: (input) => {
        const name = requireName("name", input?.name)
        const { s } = store(input)
        refuseCAS(s, name)
        const b = bucketOf(s, name)
        if (b.objects.size > 0) throw conflict("This bucket still holds objects. Delete them first.")
        s.buckets.delete(name)
        return { name }
      },
    },
    "objects.list": {
      kind: "query",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const { s } = store(input)
        const b = bucketOf(s, bucket)
        const cursor = decodeCursor(input?.cursor)
        const delimiter = input?.delimiter === undefined || input?.delimiter === null ? "/" : String(input.delimiter)
        const prefix = typeof input?.prefix === "string" ? input.prefix : ""
        const sorted = [...b.objects.keys()].sort()
        const page = pageKeys(sorted, { prefix, delimiter, cursor, limit: clampLimit(input?.limit) })
        return {
          objects: page.keys.map((k) => row(k, b.objects.get(k))),
          prefixes: delimiter === "" ? null : page.prefixes,
          nextCursor: page.next === "" ? null : b64(page.next),
          foldersSupported: delimiter !== "",
          routed: s.backends.length > 0,
        }
      },
    },
    "objects.head": {
      kind: "query",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        const o = objectOf(s, bucket, key)
        const rows = matchingRows(s)
        return { object: detail(key, o), middleware: rows, presign: presignOf(s, rows) }
      },
    },
    "objects.contentUrl": {
      kind: "query",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const purpose = input?.purpose ?? "download"
        if (purpose !== "" && purpose !== "download" && purpose !== "preview") throw badRequest('purpose must be "download" or "preview"')
        const limit = typeof input?.limit === "number" ? input.limit : 0
        if (limit < 0) throw badRequest("limit cannot be negative")
        const { name, s } = store(input)
        objectOf(s, bucket, key)
        const op = purpose === "preview" ? "preview" : "download"
        const t = ticket({ s: name, b: bucket, k: key, o: op, l: op === "preview" ? (limit === 0 || limit > MAX_PREVIEW ? MAX_PREVIEW : limit) : undefined }, 60)
        return { url: `${CONTENT_PATH}?t=${encodeURIComponent(t.token)}`, expiresAt: t.expiresAt }
      },
    },
    "objects.beginUpload": {
      kind: "command",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const size = typeof input?.size === "number" ? input.size : 0
        if (size < 0) throw badRequest("size cannot be negative")
        if (size > MAX_UPLOAD) throw badRequest(`This file is larger than the upload limit of ${MAX_UPLOAD} bytes.`, { maxUploadBytes: MAX_UPLOAD })
        const { name, s } = store(input)
        refuseCAS(s, bucket)
        const b = bucketOf(s, bucket)
        if (b.objects.has(key) && input?.overwrite !== true) throw conflict("an object with this key already exists", { exists: true })
        const t = ticket({ s: name, b: bucket, k: key, o: "upload", n: size, ct: input?.contentType ?? "", ow: input?.overwrite === true }, 900)
        return { url: CONTENT_PATH, ticket: t.token, expiresAt: t.expiresAt }
      },
    },
    "objects.completeUpload": {
      kind: "command",
      invalidates: ["objects.list", "objects.head"],
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        return row(key, objectOf(s, bucket, key))
      },
    },
    "objects.delete": {
      kind: "command",
      invalidates: ["objects.list", "objects.head", "cas.list"],
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        refuseCAS(s, bucket)
        // Delete is idempotent in Trove: a missing key is not an error.
        bucketOf(s, bucket).objects.delete(key)
        return { key }
      },
    },
    "objects.copy": {
      kind: "command",
      invalidates: ["objects.list", "objects.head"],
      handler: (input) => {
        const srcBucket = requireName("srcBucket", input?.srcBucket)
        const dstBucket = requireName("dstBucket", input?.dstBucket)
        if (!input?.srcKey || !input?.dstKey) throw badRequest("srcKey and dstKey are required")
        if (srcBucket === dstBucket && input.srcKey === input.dstKey) throw badRequest("the source and the destination are the same object")
        const { s } = store(input)
        refuseCAS(s, srcBucket)
        refuseCAS(s, dstBucket)
        const o = objectOf(s, srcBucket, input.srcKey)
        const dst = bucketOf(s, dstBucket)
        if (dst.objects.has(input.dstKey) && input?.overwrite !== true) throw conflict("an object with this key already exists", { exists: true })
        const copy = { ...o, lastModified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") }
        dst.objects.set(input.dstKey, copy)
        return row(input.dstKey, copy)
      },
    },
    "objects.presign": {
      kind: "command",
      handler: (input) => {
        const bucket = requireName("bucket", input?.bucket)
        const key = requireKey(input?.key)
        const { s } = store(input)
        objectOf(s, bucket, key)
        const status = presignOf(s, matchingRows(s))
        if (!status.available) throw unavailable(status.reason)
        let secs = typeof input?.expiresSeconds === "number" ? Math.trunc(input.expiresSeconds) : 0
        if (secs === 0) secs = 3600
        secs = Math.min(Math.max(secs, 60), 7 * 24 * 3600)
        const expiresAt = new Date(Date.now() + secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")
        return { url: `https://archive.s3.example/${bucket}/${encodeURIComponent(key)}?X-Amz-Expires=${secs}`, expiresAt }
      },
    },
    "middleware.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const tested = typeof input?.bucket === "string" && input.bucket !== "" && typeof input?.key === "string" && input.key !== ""
        const registrations = s.registrations.map((r) => ({
          ...r,
          matchesWrite: tested ? r.direction !== "read" : null,
          matchesRead: tested ? r.direction !== "write" : null,
        }))
        const warnings = s.registrations.length > 0
          ? [{ code: "bypass", message: "CAS, copy and streams move stored bytes without running any middleware." }]
          : []
        return { registrations, warnings }
      },
    },
    "cas.status": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        if (!s.cas) return { enabled: false, algorithm: null, bucket: null, index: null, resetsOnRestart: false, releaseSupported: false }
        return { enabled: true, algorithm: s.cas.algorithm, bucket: s.cas.bucket, index: "memory", resetsOnRestart: true, releaseSupported: false }
      },
    },
    "cas.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const cas = requireCAS(s)
        const b = s.buckets.get(cas.bucket)
        if (!b) return { entries: [], nextCursor: null }
        const cursor = decodeCursor(input?.cursor)
        const page = pageKeys([...b.objects.keys()].sort(), { prefix: "", delimiter: "", cursor, limit: clampLimit(input?.limit) })
        const entries = page.keys.map((hash) => {
          const o = b.objects.get(hash)
          const e = s.index.get(hash)
          return {
            hash,
            storedSize: o.storedSize,
            lastModified: o.lastModified,
            indexed: e !== undefined,
            refCount: e ? e.refCount : null,
            pinned: e ? e.pinned : null,
          }
        })
        return { entries, nextCursor: page.next === "" ? null : b64(page.next) }
      },
    },
    "cas.pin": casPin(true),
    "cas.unpin": casPin(false),
    "cas.gc": {
      kind: "command",
      invalidates: ["cas.list", "cas.status"],
      handler: (input) => {
        const { s } = store(input)
        requireCAS(s)
        const candidates = [...s.index.values()].filter((e) => e.refCount === 0 && !e.pinned).length
        return { scanned: candidates, deleted: 0, freedBytes: 0, errors: 0 }
      },
    },
    "streams.list": {
      kind: "query",
      handler: (input) => {
        const { s } = store(input)
        const streams = [...s.streams].sort((a, b) => (a.id < b.id ? -1 : 1))
        return { streams, active: streams.length, max: s.config.poolSize }
      },
    },
  }

  function casPin(pin) {
    return {
      kind: "command",
      invalidates: ["cas.list"],
      handler: (input) => {
        const hash = typeof input?.hash === "string" ? input.hash : ""
        if (hash === "") throw badRequest("hash is required")
        const { s } = store(input)
        requireCAS(s)
        const e = s.index.get(hash)
        if (!e) throw notFound("this hash is not in the CAS index. The index is kept in memory and forgets every entry on restart.")
        e.pinned = pin
        const o = s.buckets.get(s.cas.bucket)?.objects.get(hash)
        return { hash, storedSize: o ? o.storedSize : 0, lastModified: null, indexed: true, refCount: e.refCount, pinned: e.pinned }
      },
    }
  }
}
```

Cross-check every `invalidates` list against the Go manifest (`trove/extension/contract/manifest.yaml`); they must be identical, and `objects.beginUpload` and `objects.presign` have none.

- [ ] **Step 2: Register the contributor in `server.mjs`**

Read the current `server.mjs` first (another session may have edited it since). Add, next to the other fixture imports:

```js
import { createTroveHandlers, resetTrove } from "./trove-fixtures.mjs"
```

add to `CONTRIBUTORS` after the vault entry:

```js
  { name: "trove", envPrefix: "TROVE", handlers: createTroveHandlers(FixtureError) },
```

and call `resetTrove()` in the `_fixture/reset` handler next to `resetVault()`. Put each addition on its own line(s), away from any other session's uncommitted lines (`git diff packages/fixture-server/server.mjs` shows them), so every hunk you commit contains the word `trove`.

- [ ] **Step 3: Add the verify inputs and spot checks**

In `verify.mjs`, add an `INPUT` block (each line contains `trove::`):

```js
  // trove: the seed in trove-fixtures.mjs. Store "primary" is the default; "archive" is s3 and can presign.
  "trove::objects.list": { bucket: "reports" },
  "trove::objects.head": { bucket: "reports", key: "readme.txt" },
  "trove::objects.contentUrl": { bucket: "reports", key: "readme.txt" },
  "trove::middleware.list": { bucket: "reports", key: "readme.txt" },
  "trove::buckets.create": { name: "verify-trove-bucket" },
  "trove::buckets.delete": { name: "empty" },
  "trove::objects.delete": { bucket: "reports", key: "2026/08/summary.json" },
  "trove::objects.copy": { srcBucket: "reports", srcKey: "readme.txt", dstBucket: "assets", dstKey: "readme-copy.txt" },
  "trove::objects.beginUpload": { bucket: "reports", key: "verify/trove-upload.txt", size: 5, contentType: "text/plain" },
  "trove::objects.completeUpload": { bucket: "reports", key: "readme.txt" },
  "trove::objects.presign": { store: "archive", bucket: "backups", key: "db/2026-09-30.dump" },
  "trove::cas.pin": { hash: "sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1" },
  "trove::cas.unpin": { hash: "sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2" },
```

Then read how the vault spot checks are written (search `verify.mjs` for the vault spot-check block) and add a trove block in the same style that proves writes change the next read and refusals are real:
- `buckets.create {name:"verify-trove-2"}` then `buckets.list` contains `verify-trove-2`;
- `buckets.delete {name:"reports"}` answers `CONFLICT`;
- `objects.list {bucket:"reports", limit: 1}` answers a non-null `nextCursor`, and passing it back answers a different first item;
- `objects.list {bucket:"reports", cursor:"!!!"}` answers `BAD_REQUEST`;
- `system.status {store:"  "}` answers `BAD_REQUEST` and `{store:"nope"}` answers `NOT_FOUND`;
- `cas.list {store:"archive"}` answers `UNAVAILABLE`;
- `objects.presign {bucket:"reports", key:"readme.txt"}` (default store, local) answers `UNAVAILABLE`.

Call `POST {base}/_fixture/reset` (as other blocks do) before the spot checks so the main loop's writes do not change their answers. If a main-loop entry fails because of order (for example `buckets.delete empty` runs after something else), fix the input, not the fixture.

- [ ] **Step 4: Run the fixture server and the verifier**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
FIXTURE_PORT=8299 node packages/fixture-server/server.mjs > /tmp/trove-fixture.log 2>&1 &
sleep 1
node packages/fixture-server/verify.mjs http://localhost:8299 | tail -40
kill %1
```
Expected: every `trove::` intent passes and every trove spot check passes. Failures in other contributors are not yours: record the ones that do not mention trove, and do not fix them. Never stash to compare.

- [ ] **Step 5: Commit with the helper**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
bash "$W/commit-mine.sh" \
  -m "feat(fixture-server): add trove fixtures for all 20 intents" \
  -m "<body>" \
  --whole packages/fixture-server/trove-fixtures.mjs \
  --shared packages/fixture-server/server.mjs:trove packages/fixture-server/verify.mjs:trove
git show HEAD -- packages/fixture-server/server.mjs packages/fixture-server/verify.mjs
```
Confirm every committed hunk is yours.

---

### Task 8: Mount the plugin in the shell and the Next example

**Files:**
- Modify: `apps/shell/package.json`, `apps/shell/src/App.tsx`
- Modify: `apps/example-next/package.json`, `apps/example-next/forge.config.ts`, `apps/example-next/app/globals.css`
- Modify (through `pnpm install`): `pnpm-lock.yaml`

- [ ] **Step 1: Wire the shell**

Add `"@forge-go/dashboard-plugin-trove": "workspace:*"` to `apps/shell/package.json` dependencies in alphabetical order. In `apps/shell/src/App.tsx` add `import trovePlugin from "@forge-go/dashboard-plugin-trove"` beside the vault import and `trovePlugin,` to the plugins array beside `vaultPlugin`.

Do NOT edit `apps/shell/src/styles.css`: it is another session's untracked file. The plugin's Tailwind classes all also occur in the kit, which `globals.css` scans, so they render; if a class does not, record it for Rex in your report.

- [ ] **Step 2: Wire the Next example**

Add the same dependency to `apps/example-next/package.json`, import `trovePlugin` in `apps/example-next/forge.config.ts` and add it to `plugins`, and add `@source "../../../packages/plugin-trove/src/**/*.{ts,tsx}";` after the authsome line in `apps/example-next/app/globals.css`.

The Next proxy cannot carry trove's content routes yet (it reads bodies as text with a 1 MiB cap); that is a known gap recorded in the spec, not something to fix here.

- [ ] **Step 3: Install and build**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm install
pnpm --filter @forge-go/dashboard-shell build
```
Expected: install links the plugin into both apps; the shell build succeeds. If the shell build fails for a reason unrelated to trove (another session's uncommitted shell files), record the error and continue: run `pnpm --filter @forge-go/dashboard-shell exec tsc --noEmit -p .` if available, or say BLOCKED with the output.

- [ ] **Step 4: Commit with the helper**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
bash "$W/commit-mine.sh" \
  -m "feat(shell): mount the trove plugin" \
  -m "<body>" \
  --shared apps/shell/package.json:trove apps/shell/src/App.tsx:trove apps/example-next/package.json:trove apps/example-next/forge.config.ts:trove apps/example-next/app/globals.css:trove pnpm-lock.yaml:plugin-trove
git show HEAD
```
Confirm every hunk names trove and nothing from another session (notably the lockfile's `plugin-bastion` lines) is in the commit.

---

### Task 9: Verify the slice and record what it found

Run by the controller (it needs the in-app browser), not by a subagent.

- [ ] **Step 1: Package checks**

```bash
cd /Users/rexraphael/Work/xraph/forge-dashboard
pnpm --filter @forge-go/dashboard-plugin-trove test
pnpm --filter @forge-go/dashboard-plugin-trove typecheck
pnpm --filter @forge-go/dashboard-plugin-trove lint
pnpm -r test 2>&1 | tail -30
```
Expected: the trove package is clean. In `pnpm -r test`, `packages/host/test/setup-screen.test.tsx` is a known failure that is not ours; any other failure that mentions trove is.

- [ ] **Step 2: Click through in the browser**

Start the `fixture-server` and `dashboard-shell` launch configs (`.claude/launch.json`). Open the shell, go to the Storage group, and check each page against the spec: Overview (encryption "Configured, not applied" on primary; switch the store to archive and see the routing note with `cold`, presign "Share links can be offered"), Buckets (create a bucket and see it appear; delete `reports` and see the refusal inside the dialog; delete `empty` and see it go), Middleware (test `reports`/`readme.txt`: compress Runs on both), CAS (two indexed rows and one Not indexed; pin and unpin change the badge after the refresh; GC reports zero), Transfers (two streams, the paused one with no expected size). Take a screenshot of each page. Note anything that renders unstyled.

- [ ] **Step 3: Record what slice 3 found**

Append `## What slice 3 found that slice 4 must know` to the spec: the store selection model (module state in sessionStorage, `withStore`), the dropped CAS lookup and why, the `apps/shell/src/styles.css` `@source` situation, any copy or layout decisions slice 4's browser should match, fixture details slice 4 builds on (seed keys, the unsigned fixture tickets and content path), and the two stale older spec lines (beginUpload's return and `PUT {path}?t=`) corrected to point at the slice 2 section. Commit with `git commit --only` on the spec path.
