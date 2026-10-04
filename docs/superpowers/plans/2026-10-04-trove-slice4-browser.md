# Trove slice 4: the object browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `packages/plugin-trove` an object browser at `/buckets/:bucket` (listing with folders and Load more, an inspector with previews, download, share, copy, delete, and drag-and-drop uploads through the ticketed content routes), give the fixture server those content routes, and record what the new lazy chunks cost in `BASELINE.md`.

**Architecture:** The browser is one lazy route. The page reads `store`, `prefix` and `key` from the query string and links within itself with absolute `/@trove/...` paths, because the host's link resolver appends the current search to every scope-relative link. The listing is a hook that owns the first page through `useQuery` (so `invalidates` refresh it) and accumulates further pages through the scoped client. Uploads live in a module-level queue so they survive navigation. CodeMirror is a second lazy boundary inside the preview. The fixture's content routes live in `trove-fixtures.mjs`; `server.mjs` gains one import and one dispatch line.

**Tech Stack:** React 19, TypeScript 6, vitest 5 + Testing Library + jsdom, `@forge-go/dashboard-plugin` (useQuery, useCommand, usePluginClient, PluginLink, useNavigateTo, NavigationProvider, queryStore), `@forge-go/dashboard-kit` (Table, ResizablePanelGroup, Progress, Dialog, ConfirmDialog with `children`, DescriptionList, TagList, Timestamp, NoneCell, EmptyState, Alert, CommandAlert), `@tanstack/react-virtual`, `@codemirror/*` 6, lucide icons via `@forge-go/dashboard-kit/icons`. Node 20 for the fixture server.

**Spec:** `docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md`, sections "The browser", "Lazy loading and dependencies", "Content routes and tickets", "Fixtures", "Testing", and the authoritative sections "What slice 2 found that slice 3 must know" and "What slice 3 found that slice 4 must know" at the end. Where the older text and those sections disagree, the later sections win.

## Global Constraints

- Repository: `/Users/rexraphael/Work/xraph/forge-dashboard`, branch `main`. No worktrees. Other sessions keep 100+ uncommitted files here and some stage files.
- You may edit only: `packages/plugin-trove/**`, `packages/fixture-server/trove-fixtures.mjs`, trove's lines in `packages/fixture-server/server.mjs` and `packages/fixture-server/verify.mjs`, and `pnpm-lock.yaml` through `pnpm install` (trove's importer block only). The controller alone edits `BASELINE.md` and the spec. Never edit `apps/shell/src/styles.css`, `apps/shell/vite.config.ts`, the kit, the host or another plugin.
- Commits for files wholly yours (`packages/plugin-trove/**`, `trove-fixtures.mjs`): `git add <explicit files>` then `git commit --only -m "<subject>" -m "<a 2 to 5 line body, per Global Constraints>" -- <explicit paths>`, then `git show --stat HEAD`. zsh: write paths out, never `git add $F`.
- Commits that touch a SHARED file (`server.mjs`, `verify.mjs`, `pnpm-lock.yaml`): use `bash /Users/rexraphael/Work/xraph/forge-dashboard/.superpowers/tools/commit-mine.sh -m SUBJECT -m BODY --whole <your own files> --shared <path>:<NEEDLE>`. NEEDLE is a case-sensitive string every one of your hunks in that file contains, or `@lines=LO-HI` to take the hunks whose old-side start line is inside HEAD's lines LO..HI. Then `git show HEAD -- <shared path>` and confirm every committed line is yours, and `git diff -- <shared path>` still shows the other sessions' edits. If the helper hits an `index.lock` held by another process, wait and retry; never delete the lock.
- NEVER run `git add -A`, `git add .`, `git checkout -- .`, `git restore .`, `git reset` (any form), `git stash`, `git clean` or `--amend`. To undo your own change to a file, edit it back.
- Change `verify.mjs` with the Edit tool only, never a script that rewrites the whole file: it carries other sessions' uncommitted edits.
- Commit messages: no `Co-Authored-By`, no AI attribution, no em or en dashes. Body: plain prose, "you" where natural, 2 to 5 lines.
- No em or en dashes anywhere in code, comments, test names, UI copy.
- `extension: "trove"`, `namespace: "trove"`, `label: "Trove"`, nav group "Storage". The browser route has no nav entry.
- Every query and command sends `store` only for a non-default store; otherwise the field is absent (never `""`). Use `withStore(store, params)` from `src/store.ts`. On the browser page the store comes from the URL's `?store=`, not from `useActiveStore()`.
- Links inside the browser, and the Buckets page's links into it, use `browserHref()` (Task 1), which returns an absolute `/@trove/...` path. Never pass a scope-relative path with a query string to `PluginLink` or `useNavigateTo`: the host appends the current search and the URL comes out as `...?prefix=a?prefix=b`.
- Classes: `apps/shell/src/styles.css` does not scan `packages/plugin-trove`, so every Tailwind class you use must already appear in a scanned package. Check new ones with:
  ```bash
  for c in CLASS1 CLASS2; do grep -rqF -- "$c" packages/kit/src packages/host/src packages/plugin-core/src packages/plugin-authsome/src packages/plugin-streaming/src packages/plugin-relay/src packages/plugin-warden/src packages/plugin-vault/src packages/plugin-ledger/src packages/plugin-bastion/src packages/plugin-chronicle/src || echo "NOT GENERATED: $c"; done
  ```
  Arbitrary values (`h-[60vh]`) are never generated. Geometry the virtualiser computes, and the listing's scroll height, go in an inline `style`, which needs no class.
- The five conventions: identifiers (keys, ETags, hashes, bucket names, byte sizes, content types, prefixes) carry `font-mono text-xs`; the column an operator reads carries `font-medium`; every table caption carries a live count including at zero; a "none" cell uses `NoneCell`/`TagList`/`Timestamp`, never a blank or a bare dash; badge colour follows proportion.
- Never show a total the driver did not produce. A listing caption counts what is shown and says when there is more.
- "Applies now" is current configuration, worded as such. Never say an object "is" compressed, encrypted or scanned.
- Errors from a command shown in a dialog render INSIDE the dialog (`CommandAlert`; in a `ConfirmDialog` it goes in `children`). Call `reset()` when a dialog OPENS. Every `ConfirmDialog` gets `pending`. A dialog must not close while its command is in flight.
- Content tickets are minted when the operator acts (Download clicked, preview shown), never when a row renders: download and preview tickets live 60 seconds.
- User content is never shown inline from the content route. Text is fetched and rendered by CodeMirror; images are fetched into a Blob and shown through an object URL in an `<img>`.
- Tests use `test/harness.tsx`. `stubClient` refuses any intent not in its map; failure tests use a client that throws `ContractError`.
- Per package: `pnpm --filter @forge-go/dashboard-plugin-trove test`, `typecheck` and `lint` all clean before every commit of the package.
- New runtime dependencies, exactly these and no others: `@codemirror/commands ^6.11.1`, `@codemirror/lang-json ^6.0.2`, `@codemirror/language ^6.12.4`, `@codemirror/search ^6.7.2`, `@codemirror/state ^6.7.6`, `@codemirror/view ^6.43.13` (relay's versions), and `@tanstack/react-virtual ^3.14.11` (kit's). No upload, image or drop-zone library.

## Review Focus

1. Keys with characters that mean something in a URL or a filename (`q3 résumé #1.pdf`, `a+b%2F?c`) must survive the round trip through the browser's URL, the listing links and the download's `Content-Disposition`. Pinned in Task 1 (`browserHref` round trip) and Task 2 (`filename*` in verify).
2. A ticket minted early and used late expires. Download must ask for its link on click, and the listing must never ask for one. Pinned in Task 4 (no `objects.contentUrl` until Download is clicked).
3. Back and forward between prefixes must move the listing, not just the address bar. Pinned in Task 1 (`useBrowserLocation` follows `popstate`).
4. An upload must keep going, and stay visible, when the operator opens another prefix or leaves the page and comes back. Pinned in Task 7 (queue survives an unmount).
5. An object deleted or replaced while the inspector shows it must read as gone or refreshed, never crash or show the old bytes. Pinned in Task 4 (head `NOT_FOUND` message) and Task 6 (preview keyed by ETag).

---

## File structure

| file | responsibility | task |
|---|---|---|
| `src/types.ts` (modify) | wire types for objects, links, upload tickets | 1 |
| `src/browser-location.ts` | `TROVE_MOUNT`, `browserHref`, `parseBrowserSearch`, `useBrowserLocation`, `folderOf`, `displayName` | 1 |
| `src/components/path-bar.tsx` | the prefix as linked mono segments, tail as an input | 1 |
| `src/pages/browser.tsx` | the lazy page: header, path bar, layout, wiring | 1, 3, 4, 7 |
| `src/index.tsx` (modify) | lazy `/buckets/:bucket` route | 1 |
| `src/pages/buckets.tsx` (modify) | bucket names link into the browser | 1 |
| `test/setup.ts` | ResizeObserver stub for jsdom | 1 |
| `packages/fixture-server/trove-fixtures.mjs` (modify) | seeded bodies, `handleTroveContent` | 2 |
| `packages/fixture-server/server.mjs` (modify) | import and dispatch the content route | 2 |
| `packages/fixture-server/verify.mjs` (modify) | content route spot checks | 2 |
| `src/listing.ts` | `useListing`, `mergePage`, `listingCaption` | 3 |
| `src/components/object-listing.tsx` | the table, empty states, routed note, Load more, virtualisation | 3 |
| `src/content.ts` | `previewKind`, `fetchContent`, `downloadObject`, limits | 4, 6 |
| `src/components/inspector.tsx` | `objects.head` fields, Download, Copy key | 4, 5, 6 |
| `src/components/object-actions.tsx` | Share link, Copy to, Delete dialogs | 5 |
| `src/components/preview.tsx` | text, image and none previews | 6 |
| `src/components/code-view.tsx` | read-only CodeMirror, the only file naming `@codemirror` | 6 |
| `src/uploads.ts` | module-level upload queue with XHR | 7 |
| `src/components/upload-tray.tsx` | tray rows, drop zone, Upload files button | 7 |

---

### Task 1: Dependencies, browser URL model, lazy route and bucket links

**Files:**
- Modify: `packages/plugin-trove/package.json`, `pnpm-lock.yaml` (trove importer only), `packages/plugin-trove/vitest.config.ts`
- Modify: `packages/plugin-trove/src/types.ts`, `src/index.tsx`, `src/pages/buckets.tsx`
- Create: `src/browser-location.ts`, `src/components/path-bar.tsx`, `src/pages/browser.tsx`, `test/setup.ts`
- Test: `test/browser-location.test.tsx`, `test/lazy-chunks.test.ts`, modify `test/plugin.test.tsx`, `test/buckets.test.tsx`

**Interfaces:**
- Produces: the types below; `TROVE_MOUNT = "/@trove"`; `browserHref(bucket: string, loc?: Partial<BrowserLocation>): string`; `parseBrowserSearch(search: string): BrowserLocation`; `useBrowserLocation(): BrowserLocation`; `folderOf(prefix: string): string`; `displayName(key: string, folder: string): string`; `PathBar({ bucket, store, prefix })`; `BrowserPage` (default export of `src/pages/browser.tsx`).

- [ ] **Step 1: Add the dependencies and the lockfile entry**

Record the lockfile's current foreign hunks, then add the seven dependencies to `packages/plugin-trove/package.json` as a new `"dependencies"` field (keep every other field as it is):

```json
  "dependencies": {
    "@codemirror/commands": "^6.11.1",
    "@codemirror/lang-json": "^6.0.2",
    "@codemirror/language": "^6.12.4",
    "@codemirror/search": "^6.7.2",
    "@codemirror/state": "^6.7.6",
    "@codemirror/view": "^6.43.13",
    "@tanstack/react-virtual": "^3.14.11"
  },
```

```bash
git diff -U0 HEAD -- pnpm-lock.yaml | grep '^@@' > /tmp/trove-lock-before.txt; cat /tmp/trove-lock-before.txt
pnpm install
git diff -U0 HEAD -- pnpm-lock.yaml | grep '^@@'
L1=$(git show HEAD:pnpm-lock.yaml | grep -n '^  packages/plugin-trove:$' | cut -d: -f1)
L2=$(git show HEAD:pnpm-lock.yaml | awk -v s="$L1" 'NR>s && /^  [^ ]/ {print NR-1; exit}')
echo "trove importer block in HEAD: $L1-$L2"
```

Expected: every hunk that is new after the install starts inside `L1..L2`. If any new hunk falls outside that block (a `packages:` or `snapshots:` entry), stop and report BLOCKED with the hunk headers: the versions should already be in the lockfile through relay and kit.

- [ ] **Step 2: Add the jsdom ResizeObserver stub**

`test/setup.ts`:

```ts
// react-resizable-panels and @tanstack/react-virtual both observe element
// sizes. jsdom has no ResizeObserver, so give them one that never fires.
// Layout in jsdom is all zeros anyway; tests that need a size pass one in.
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}
```

In `vitest.config.ts` change `setupFiles` to `["../test-support/jsdom-setup.ts", "./test/setup.ts"]`.

- [ ] **Step 3: Add the wire types**

Append to `src/types.ts`:

```ts
/** One object row as `objects.list`, `objects.copy` and `objects.completeUpload` return it. */
export interface ObjectRow {
  key: string
  /** Bytes as stored, after any write middleware. Not the logical size. */
  storedSize: number
  etag: string | null
  lastModified: string | null
  contentType: string | null
  storageClass: string | null
}

export interface ObjectsList {
  objects: ObjectRow[]
  /** Common prefixes, sorted. `null` only on a flat listing. */
  prefixes: string[] | null
  nextCursor: string | null
  foldersSupported: boolean
  /** True when the store routes some keys to another backend. */
  routed: boolean
}

export interface ObjectDetail extends ObjectRow {
  versionId: string | null
  metadata: Record<string, string> | null
}

export interface HeadMiddleware {
  name: string
  direction: string
  scope: string
  priority: number
}

export interface ObjectHead {
  object: ObjectDetail
  /** Middleware whose scope matches this key in the current config. */
  middleware: HeadMiddleware[]
  presign: { available: boolean; reason: string | null }
}

/** `objects.contentUrl` and `objects.presign`. */
export interface ContentLink {
  url: string
  expiresAt: string
}

/** `objects.beginUpload`: PUT the body to `url` with `ticket` in X-Trove-Ticket. */
export interface UploadTicket {
  url: string
  ticket: string
  expiresAt: string
}
```

- [ ] **Step 4: Write the failing location tests**

`test/browser-location.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { mountPath } from "@forge-go/dashboard-plugin"
import trovePlugin from "../src/index"
import {
  TROVE_MOUNT,
  browserHref,
  displayName,
  folderOf,
  parseBrowserSearch,
  useBrowserLocation,
} from "../src/browser-location"

afterEach(() => {
  window.history.replaceState(null, "", "/")
})

describe("browserHref", () => {
  it("is the plugin's real mount point", () => {
    expect(`${TROVE_MOUNT}/buckets/x`).toBe(mountPath(trovePlugin, "/buckets/x"))
  })

  it("leaves out every empty part", () => {
    expect(browserHref("reports")).toBe("/@trove/buckets/reports")
    expect(browserHref("reports", { store: "", prefix: "", key: "" })).toBe("/@trove/buckets/reports")
  })

  it("carries store, prefix and key in the query", () => {
    expect(browserHref("backups", { store: "archive", prefix: "db/", key: "db/x.dump" })).toBe(
      "/@trove/buckets/backups?store=archive&prefix=db%2F&key=db%2Fx.dump",
    )
  })

  it("round-trips keys with characters that mean something in a URL", () => {
    for (const key of ["q3 résumé #1.pdf", "a+b%2F?c", "2026//odd/", "&=?#"]) {
      const href = browserHref("reports", { prefix: key, key })
      const search = href.slice(href.indexOf("?"))
      expect(parseBrowserSearch(search)).toEqual({ store: "", prefix: key, key })
    }
  })

  it("encodes the bucket as one path segment", () => {
    expect(browserHref("a/b")).toBe("/@trove/buckets/a%2Fb")
  })
})

describe("folderOf and displayName", () => {
  it("takes the prefix up to and including its last slash", () => {
    expect(folderOf("")).toBe("")
    expect(folderOf("2026/")).toBe("2026/")
    expect(folderOf("2026/09/sum")).toBe("2026/09/")
    expect(folderOf("sum")).toBe("")
  })

  it("shows a key relative to the folder it is listed under", () => {
    expect(displayName("2026/09/summary.json", "2026/09/")).toBe("summary.json")
    expect(displayName("2026/09/", "2026/")).toBe("09/")
    expect(displayName("other", "2026/")).toBe("other")
  })
})

describe("useBrowserLocation", () => {
  it("reads the query string", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2026%2F&key=2026%2Fa")
    const { result } = renderHook(() => useBrowserLocation())
    expect(result.current).toEqual({ store: "", prefix: "2026/", key: "2026/a" })
  })

  it("follows back and forward", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2026%2F")
    const { result } = renderHook(() => useBrowserLocation())
    act(() => {
      window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2025%2F")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(result.current.prefix).toBe("2025/")
  })
})
```

- [ ] **Step 5: Run it to see it fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/browser-location.test.tsx`
Expected: FAIL, cannot resolve `../src/browser-location`.

- [ ] **Step 6: Implement `src/browser-location.ts`**

```ts
import { useMemo, useSyncExternalStore } from "react"

/**
 * Where this plugin mounts. Trove declares no routed context dimension, so
 * its pages always live under "/@trove" (definePlugin makes the namespace the
 * extension name). test/browser-location.test.tsx checks this against the
 * platform's own mountPath.
 */
export const TROVE_MOUNT = "/@trove"

export interface BrowserLocation {
  /** "" means the default store. */
  store: string
  prefix: string
  /** The selected object's full key, "" when nothing is selected. */
  key: string
}

/**
 * The browser's address for a bucket, prefix and selected key.
 *
 * Absolute on purpose. The host's link resolver appends the CURRENT search to
 * every scope-relative path, so "/buckets/x?prefix=a" from a page already at
 * "?prefix=b" would come out as "?prefix=a?prefix=b". A path starting with the
 * scope sigil is passed through untouched, by PluginLink and useNavigateTo
 * alike.
 */
export function browserHref(bucket: string, loc: Partial<BrowserLocation> = {}): string {
  const query = new URLSearchParams()
  if (loc.store) query.set("store", loc.store)
  if (loc.prefix) query.set("prefix", loc.prefix)
  if (loc.key) query.set("key", loc.key)
  const q = query.toString()
  return `${TROVE_MOUNT}/buckets/${encodeURIComponent(bucket)}${q ? `?${q}` : ""}`
}

export function parseBrowserSearch(search: string): BrowserLocation {
  const query = new URLSearchParams(search)
  return {
    store: query.get("store") ?? "",
    prefix: query.get("prefix") ?? "",
    key: query.get("key") ?? "",
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

/**
 * The browser's place, read from the address bar.
 *
 * The plugin API gives a page route params and no search, so this reads
 * `window.location.search`. A navigation through the host's router re-renders
 * the page, and the snapshot is read again on that render; back and forward
 * fire `popstate`, which this subscribes to.
 */
export function useBrowserLocation(): BrowserLocation {
  const search = useSyncExternalStore(
    subscribe,
    () => window.location.search,
    () => "",
  )
  return useMemo(() => parseBrowserSearch(search), [search])
}

/** The prefix up to and including its last "/": the folder being listed. */
export function folderOf(prefix: string): string {
  return prefix.slice(0, prefix.lastIndexOf("/") + 1)
}

/** A key as shown under `folder`: the folder part dropped, nothing else changed. */
export function displayName(key: string, folder: string): string {
  return folder !== "" && key.startsWith(folder) ? key.slice(folder.length) : key
}
```

- [ ] **Step 7: Run the location tests**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/browser-location.test.tsx`
Expected: PASS. (`src/index.tsx` already exists, so the `mountPath` test can run now.)

- [ ] **Step 8: Write the failing route, lazy and link tests**

Add to `test/plugin.test.tsx`:

```tsx
  it("serves the browser at /buckets/:bucket as a lazy route with no nav entry", () => {
    const route = trovePlugin.routes.find((r) => r.path === "/buckets/:bucket")
    expect(route).toBeDefined()
    expect((route!.element as unknown as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for("react.lazy"))
    expect(trovePlugin.nav.some((n) => n.to.startsWith("/buckets/"))).toBe(false)
  })
```

(Use the file's existing import of `trovePlugin`; add one if the file imports it under another name.)

`test/lazy-chunks.test.ts`:

```ts
import { describe, expect, it } from "vitest"

/**
 * The browser carries a virtualiser and, behind a second boundary, CodeMirror.
 * Neither may reach the shell's entry chunk, and every page test would still
 * pass if one did. So this reads the sources and checks how they import each
 * other. Read through import.meta.glob, not node:fs, because this package's
 * tsconfig has no Node types.
 */
interface GlobbingImportMeta {
  glob: (pattern: string, options: { query?: string; eager?: boolean }) => Record<string, { default: string } | string>
}

const modules = (import.meta as unknown as GlobbingImportMeta).glob("../src/**/*.{ts,tsx}", { query: "?raw", eager: true })

function sourceOf(mod: { default: string } | string): string {
  return typeof mod === "string" ? mod : mod.default
}

function namingFiles(needle: string): string[] {
  return Object.entries(modules)
    .filter(([, mod]) => sourceOf(mod).includes(needle))
    .map(([path]) => path)
    .sort()
}

describe("the browser's heavy code stays out of the entry", () => {
  it("found the sources", () => {
    expect(Object.keys(modules).length).toBeGreaterThan(10)
    expect(modules["../src/pages/browser.tsx"]).toBeDefined()
  })

  it("reaches the browser page from the plugin entry through lazy(), not a static import", () => {
    const entry = sourceOf(modules["../src/index.tsx"])
    expect(entry).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/pages\/browser"\)\)/)
    expect(entry).not.toMatch(/^import (?!type)[^\n]*["']\.\/pages\/browser["']/m)
  })

  it("imports the browser page from nowhere else", () => {
    const importers = Object.entries(modules)
      .filter(([path]) => path !== "../src/index.tsx")
      .filter(([, mod]) => /from\s+["'][./]*pages\/browser["']/.test(sourceOf(mod)))
      .map(([path]) => path)
    expect(importers).toEqual([])
  })

  it("names CodeMirror in no file yet", () => {
    expect(namingFiles("@codemirror")).toEqual([])
  })
})
```

Add to `test/buckets.test.tsx` (use the file's existing imports and fixtures; `BUCKETS` stands for whatever `buckets.list` answer the file already defines with a `reports` row, and `MULTI` for a multi-store `stores.list` answer with `archive`; define them if missing):

```tsx
  it("links each bucket into the browser", async () => {
    renderPage(BucketsPage, stubClient({ "buckets.list": BUCKETS, "stores.list": SINGLE }))
    const link = await screen.findByRole("link", { name: "reports" })
    expect(link.getAttribute("href")).toBe("/@trove/buckets/reports")
  })

  it("carries a picked store into the browser link", async () => {
    setActiveStore("archive")
    renderPage(BucketsPage, stubClient({ "buckets.list": BUCKETS, "stores.list": MULTI }))
    const link = await screen.findByRole("link", { name: "reports" })
    expect(link.getAttribute("href")).toBe("/@trove/buckets/reports?store=archive")
  })
```

Add `test/browser-page.test.tsx`:

```tsx
import { screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import BrowserPage from "../src/pages/browser"
import { renderPage, stubClient } from "./harness"

afterEach(() => window.history.replaceState(null, "", "/"))

describe("BrowserPage header and path bar", () => {
  it("names the bucket and links back to Buckets", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient({}), { bucket: "reports" })
    expect(screen.getByRole("heading", { name: "reports" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Buckets" }).getAttribute("href")).toBe("/@trove/buckets")
  })

  it("renders each prefix segment as a link back up, and the tail as an input", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?prefix=2026%2F09%2Fsum")
    renderPage(BrowserPage, stubClient({}), { bucket: "reports" })
    const nav = screen.getByRole("form", { name: "Prefix" })
    expect(nav.querySelector('a[href="/@trove/buckets/reports"]')?.textContent).toBe("reports")
    expect(nav.querySelector('a[href="/@trove/buckets/reports?prefix=2026%2F"]')?.textContent).toBe("2026")
    expect(nav.querySelector('a[href="/@trove/buckets/reports?prefix=2026%2F09%2F"]')?.textContent).toBe("09")
    expect((screen.getByRole("textbox", { name: "Continue the prefix" }) as HTMLInputElement).value).toBe("sum")
  })

  it("names a non-default store and keeps it on every link", () => {
    window.history.replaceState(null, "", "/@trove/buckets/backups?store=archive&prefix=db%2F")
    renderPage(BrowserPage, stubClient({}), { bucket: "backups" })
    expect(screen.getByText("archive").className).toContain("font-mono")
    const nav = screen.getByRole("form", { name: "Prefix" })
    expect(nav.querySelector('a[href="/@trove/buckets/backups?store=archive"]')).toBeTruthy()
  })
})
```

- [ ] **Step 9: Run them to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test`
Expected: FAIL on the route, lazy, links and page tests.

- [ ] **Step 10: Implement the path bar**

`src/components/path-bar.tsx`:

```tsx
import { Fragment, useState } from "react"
import type { FormEvent } from "react"
import { PluginLink, useNavigateTo } from "@forge-go/dashboard-plugin"
import { Input } from "@forge-go/dashboard-kit/components/input"
import { browserHref, folderOf } from "../browser-location"

/**
 * The current prefix as the literal key: each folder segment a link back up,
 * the rest an input that continues the prefix on Enter. It never draws a
 * tree. The parent keys this by prefix, so the draft resets on navigation.
 */
export function PathBar({ bucket, store, prefix }: { bucket: string; store: string; prefix: string }) {
  const navigate = useNavigateTo()
  const folder = folderOf(prefix)
  const segments = folder === "" ? [] : folder.slice(0, -1).split("/")
  const [draft, setDraft] = useState(prefix.slice(folder.length))

  function submit(event: FormEvent) {
    event.preventDefault()
    navigate(browserHref(bucket, { store, prefix: folder + draft }))
  }

  return (
    <form aria-label="Prefix" onSubmit={submit} className="flex flex-wrap items-center gap-1 font-mono text-xs">
      <PluginLink to={browserHref(bucket, { store })} className="font-medium hover:underline">
        {bucket}
      </PluginLink>
      <span aria-hidden="true" className="text-muted-foreground">/</span>
      {segments.map((segment, i) => {
        const to = `${segments.slice(0, i + 1).join("/")}/`
        return (
          <Fragment key={to}>
            <PluginLink to={browserHref(bucket, { store, prefix: to })} className="hover:underline">
              {segment === "" ? <span className="italic text-muted-foreground">(empty)</span> : segment}
            </PluginLink>
            <span aria-hidden="true" className="text-muted-foreground">/</span>
          </Fragment>
        )
      })}
      <Input
        aria-label="Continue the prefix"
        placeholder="filter this prefix, then Enter"
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-48 font-mono text-xs"
      />
    </form>
  )
}
```

Check `h-7` and `w-48` with the class check from Global Constraints; if one is not generated, swap for the nearest that is (for example `h-8`, `w-40`) and say so in the report.

- [ ] **Step 11: Implement the page skeleton**

`src/pages/browser.tsx`:

```tsx
import type { ComponentType } from "react"
import { PluginLink } from "@forge-go/dashboard-plugin"
import type { PluginPageProps } from "@forge-go/dashboard-plugin"
import { PageHeader } from "@forge-go/dashboard-kit/components/page-header"
import { TROVE_MOUNT, useBrowserLocation } from "../browser-location"
import { PathBar } from "../components/path-bar"

/**
 * One bucket, browsed by prefix. Lazy: the plugin entry reaches this file only
 * through lazy(), so its listing, inspector and upload code stay out of the
 * shell's entry chunk.
 *
 * The store comes from the URL, not from the store picker, so a copied link
 * opens the same store. "" means the default.
 */
const BrowserPage: ComponentType<PluginPageProps> = ({ params }) => {
  const bucket = params.bucket ?? ""
  const { store, prefix } = useBrowserLocation()

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <PluginLink to={`${TROVE_MOUNT}/buckets`} className="hover:underline">
          Buckets
        </PluginLink>
      </nav>
      <PageHeader title={bucket} description="Objects as the driver lists them, one prefix at a time." />
      {store !== "" ? (
        <p className="text-sm text-muted-foreground">
          Store <span className="font-mono text-xs text-foreground">{store}</span>
        </p>
      ) : null}
      <PathBar key={prefix} bucket={bucket} store={store} prefix={prefix} />
    </section>
  )
}

export default BrowserPage
```

If `PageHeader` does not render its title as a heading, the heading test fails; then read `packages/kit/src/components/page-header.tsx` and assert on what it renders, keeping the assertion that the bucket name is the page title.

- [ ] **Step 12: Register the lazy route and link the buckets**

In `src/index.tsx` add `import { lazy } from "react"`, then above `trovePlugin`:

```tsx
/**
 * The object browser. Lazy, so its virtualiser and, behind a second boundary,
 * CodeMirror never reach the shell's entry chunk. PluginHost wraps every page
 * in Suspense, which is what makes a lazy route legal.
 */
const BrowserPage = lazy(() => import("./pages/browser"))
```

and add `{ path: "/buckets/:bucket", element: BrowserPage },` after the `/buckets` route. Do not add a nav entry.

In `src/pages/buckets.tsx`, make `columnsFor(meaning, store)` and render the name as a link:

```tsx
    {
      id: "name",
      header: "Name",
      className: "font-mono text-xs font-medium",
      cell: (b) => (
        <PluginLink to={browserHref(b.name, { store })} className="hover:underline">
          {b.name}
        </PluginLink>
      ),
    },
```

with `import { PluginLink } from "@forge-go/dashboard-plugin"` (merge into the existing import) and `import { browserHref } from "../browser-location"`, and pass `store` where `columnsFor` is called.

- [ ] **Step 13: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass.

- [ ] **Step 14: Commit**

Commit the package files with `git commit --only`, then the lockfile with the helper:

```bash
git add packages/plugin-trove/src/browser-location.ts packages/plugin-trove/src/components/path-bar.tsx packages/plugin-trove/src/pages/browser.tsx packages/plugin-trove/test/setup.ts packages/plugin-trove/test/browser-location.test.tsx packages/plugin-trove/test/lazy-chunks.test.ts packages/plugin-trove/test/browser-page.test.tsx
git commit --only -m "feat(plugin-trove): add the browser route, its URL model and bucket links" -m "<a 2 to 5 line body, per Global Constraints>" -- packages/plugin-trove/package.json packages/plugin-trove/vitest.config.ts packages/plugin-trove/src/types.ts packages/plugin-trove/src/index.tsx packages/plugin-trove/src/pages/buckets.tsx packages/plugin-trove/src/browser-location.ts packages/plugin-trove/src/components/path-bar.tsx packages/plugin-trove/src/pages/browser.tsx packages/plugin-trove/test/setup.ts packages/plugin-trove/test/browser-location.test.tsx packages/plugin-trove/test/lazy-chunks.test.ts packages/plugin-trove/test/browser-page.test.tsx packages/plugin-trove/test/plugin.test.tsx packages/plugin-trove/test/buckets.test.tsx
git show --stat HEAD
bash /Users/rexraphael/Work/xraph/forge-dashboard/.superpowers/tools/commit-mine.sh -m "chore: lock the trove plugin's editor and virtualiser dependencies" -m "<a 2 to 5 line body, per Global Constraints>" --shared "pnpm-lock.yaml:@lines=$L1-$L2"
git show HEAD -- pnpm-lock.yaml
git diff -U0 HEAD -- pnpm-lock.yaml | grep '^@@'
```

Expected: the lockfile commit holds only lines inside the trove importer block, and the remaining diff hunks equal `/tmp/trove-lock-before.txt` (line numbers may shift).

---

### Task 2: Fixture content routes

**Files:**
- Modify: `packages/fixture-server/trove-fixtures.mjs`
- Modify: `packages/fixture-server/server.mjs` (one import, one dispatch line)
- Modify: `packages/fixture-server/verify.mjs` (Edit tool only)

**Interfaces:**
- Produces: `export const TROVE_CONTENT_PATH = "/dashboard/trove/content"`; `export async function handleTroveContent(req, res, url): Promise<void>`. Seeded bodies for `reports/readme.txt`, `reports/2026/09/summary.json`, `reports/2026/08/summary.json`, `assets/logo.png`, and a new `assets/diagram.svg`.

The Go route (spec "The content route", slice 2 section) is the reference. Status codes: 403 for a missing, malformed or expired ticket, an operation that does not fit the method, a PUT without `X-Trove-Ticket` or with `?t=`; 404 for a missing store, bucket or object; 405 with `Allow: GET, PUT`; 409 for a PUT onto an existing key without overwrite; 413 for a body over the declared size; 422 for a scan block. Errors are `{"error": "<message>"}`. GET always sends the four headers below.

- [ ] **Step 1: Write the failing verify checks**

In `verify.mjs`, inside the trove spot-check block, right after the existing `objects.beginUpload` checks and before the `objects.delete` of `readme.txt`, add (Edit tool; derive the origin from the existing `base`):

```js
    // Content routes: GET and PUT at the fixture's content path, honouring tickets.
    const origin = new URL(base).origin
    const link = await tq("objects.contentUrl", { bucket: "reports", key: "readme.txt" })
    const got = await fetch(`${origin}${link.body?.data?.url}`)
    const gotText = await got.text()
    check("trove content GET answers the object's bytes", got.status === 200 && gotText.startsWith("Reports land here"), `${got.status} ${gotText.slice(0, 40)}`)
    check(
      "trove content GET sends attachment, nosniff, sandbox and no-store",
      got.headers.get("content-disposition") === "attachment; filename*=UTF-8''readme.txt" &&
        got.headers.get("x-content-type-options") === "nosniff" &&
        got.headers.get("content-security-policy") === "sandbox" &&
        got.headers.get("cache-control") === "no-store",
      JSON.stringify(Object.fromEntries(got.headers)),
    )
    const odd = await tq("objects.contentUrl", { bucket: "reports", key: "q3 résumé #1.pdf" })
    const oddGot = await fetch(`${origin}${odd.body?.data?.url}`)
    await oddGot.arrayBuffer()
    check("trove content GET encodes an awkward filename with filename*", oddGot.headers.get("content-disposition") === `attachment; filename*=UTF-8''${encodeURIComponent("q3 résumé #1.pdf")}`, oddGot.headers.get("content-disposition"))
    const preview = await tq("objects.contentUrl", { bucket: "reports", key: "readme.txt", purpose: "preview", limit: 4 })
    const previewBytes = await (await fetch(`${origin}${preview.body?.data?.url}`)).arrayBuffer()
    check("trove content GET stops a preview at its limit", previewBytes.byteLength === 4, String(previewBytes.byteLength))
    const expiredToken = Buffer.from(JSON.stringify({ s: "primary", b: "reports", k: "readme.txt", o: "download", e: 1 })).toString("base64url")
    const expired = await fetch(`${origin}/dashboard/trove/content?t=${expiredToken}`)
    check("trove content GET refuses an expired ticket with 403", expired.status === 403, String(expired.status))
    const upTicket = await tc("objects.beginUpload", { bucket: "reports", key: "spot/put.txt", size: 5, contentType: "text/plain" })
    const getWithUpload = await fetch(`${origin}/dashboard/trove/content?t=${upTicket.body?.data?.ticket}`)
    check("trove content GET refuses an upload ticket with 403", getWithUpload.status === 403, String(getWithUpload.status))
    const putInQuery = await fetch(`${origin}/dashboard/trove/content?t=${upTicket.body?.data?.ticket}`, { method: "PUT", body: "hello" })
    check("trove content PUT refuses a ticket in the query with 403", putInQuery.status === 403, String(putInQuery.status))
    const putWithDownload = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": new URL(`${origin}${link.body?.data?.url}`).searchParams.get("t") } })
    check("trove content PUT refuses a download ticket with 403", putWithDownload.status === 403, String(putWithDownload.status))
    const tooBig = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello, world", headers: { "X-Trove-Ticket": upTicket.body?.data?.ticket } })
    check("trove content PUT refuses a body over the declared size with 413", tooBig.status === 413, String(tooBig.status))
    const put = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": upTicket.body?.data?.ticket } })
    const putBody = await put.json()
    check("trove content PUT stores the body and answers key, storedSize and etag", put.status === 200 && putBody.key === "spot/put.txt" && putBody.storedSize === 5 && typeof putBody.etag === "string", JSON.stringify(putBody))
    const completed = await tc("objects.completeUpload", { bucket: "reports", key: "spot/put.txt" })
    const back = await tq("objects.contentUrl", { bucket: "reports", key: "spot/put.txt" })
    const backText = await (await fetch(`${origin}${back.body?.data?.url}`)).text()
    check("trove upload round trip: completeUpload sees it and GET returns the same bytes", completed.body?.ok === true && completed.body.data.contentType === "text/plain" && backText === "hello", backText)
    const again = await tc("objects.beginUpload", { bucket: "reports", key: "spot/put2.txt", size: 5 })
    await tc("objects.copy", { srcBucket: "reports", srcKey: "spot/put.txt", dstBucket: "reports", dstKey: "spot/put2.txt" })
    const raced = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": again.body?.data?.ticket } })
    check("trove content PUT onto a key that appeared since the ticket is 409", raced.status === 409, String(raced.status))
    const scanTicket = await tc("objects.beginUpload", { bucket: "reports", key: "spot/eicar.txt", size: 5 })
    const scanned = await fetch(`${origin}/dashboard/trove/content`, { method: "PUT", body: "hello", headers: { "X-Trove-Ticket": scanTicket.body?.data?.ticket } })
    check("trove content PUT answers 422 when the fixture's scan blocks a key containing eicar", scanned.status === 422, String(scanned.status))
    const posted = await fetch(`${origin}/dashboard/trove/content`, { method: "POST" })
    check("trove content route answers 405 with Allow for other methods", posted.status === 405 && posted.headers.get("allow") === "GET, PUT", `${posted.status} ${posted.headers.get("allow")}`)
    // The scope matcher (slice 3 deferral): key(*.log) matches a .log key and not a dump.
    const dumpMw = await tq("middleware.list", { store: "archive", bucket: "backups", key: "db/2026-09-29.dump" })
    const logMw = await tq("middleware.list", { store: "archive", bucket: "backups", key: "app.log" })
    check("trove scope matcher: key(*.log) skips a dump and matches a .log key", dumpMw.body?.data?.registrations?.[0]?.matchesWrite === false && logMw.body?.data?.registrations?.[0]?.matchesWrite === true, JSON.stringify([dumpMw.body?.data?.registrations, logMw.body?.data?.registrations]))
```

Start a fixture server on a scratch port (port 8099 belongs to the controller's preview; never touch it) and run verify:

```bash
FIXTURE_PORT=18761 node packages/fixture-server/server.mjs > /tmp/trove-fixture.log 2>&1 &
sleep 1
node packages/fixture-server/verify.mjs http://localhost:18761
kill %1
```

Expected: the new trove checks FAIL (404 from the content path).

- [ ] **Step 2: Seed bodies**

In `trove-fixtures.mjs`, let `obj()` take `extra.body` (a string or Buffer) and keep it:

```js
    body: extra.body === undefined ? null : Buffer.isBuffer(extra.body) ? extra.body : Buffer.from(extra.body, "utf8"),
```

and give these seeded objects bodies (keep their other fields as they are):

```js
const README = "Reports land here.\nMonthly summaries live under YYYY/MM/summary.json.\n"
const SUMMARY_09 = JSON.stringify({ month: "2026-09", total: 4812, rows: [{ team: "ops", count: 31 }, { team: "billing", count: 12 }] })
const SUMMARY_08 = JSON.stringify({ month: "2026-08", total: 3901, rows: [{ team: "ops", count: 27 }] })
// A 1x1 PNG, the smallest valid image.
const LOGO_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64")
// An SVG with a script in it. Shown through an <img>, the script cannot run;
// that is what the browser's preview relies on.
const DIAGRAM_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" rx="8" fill="#4f46e5"/><text x="60" y="36" font-size="16" text-anchor="middle" fill="white">trove</text><script>alert("this must never run")</script></svg>'
```

`reports/readme.txt` gets `body: README`, the two summaries their JSON, `assets/logo.png` `body: LOGO_PNG`, and add `["diagram.svg", obj(DIAGRAM_SVG.length, 60 * 24, { contentType: "image/svg+xml", body: DIAGRAM_SVG })]` to `assets`. `detail()` and `row()` must not return `body`.

- [ ] **Step 3: Implement the content route**

Add near the top constants: `export const TROVE_CONTENT_PATH = CONTENT_PATH`. Add `import { createHash } from "node:crypto"` at the top. Then, after `createTroveHandlers`, add a module-level handler. It reads `state` directly (it is module state) and reuses the scope matching the handlers use; if `matchingRows` lives inside `createTroveHandlers`, move the pure helpers it needs (`matchingRows` and what it calls) to module level so both can use them, without changing their behaviour.

```js
// What the Go route checks with an HMAC, the fixture checks by shape: the
// ticket is base64url JSON (see ticket() above). It still enforces the
// operation, the expiry, the header for PUT and the declared size, so the
// browser meets the same refusals it will meet against Go.
function readTicket(token) {
  if (typeof token !== "string" || token === "") return { error: "This request has no ticket." }
  let t
  try {
    t = JSON.parse(Buffer.from(token, "base64url").toString("utf8"))
  } catch {
    return { error: "This ticket is malformed." }
  }
  if (!t || typeof t !== "object" || typeof t.s !== "string" || typeof t.b !== "string" || typeof t.k !== "string") return { error: "This ticket is malformed." }
  if (typeof t.e !== "number" || t.e * 1000 < Date.now()) return { error: "This ticket has expired. Ask for a new link." }
  return { ticket: t }
}

function sendContentError(res, status, message, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers })
  res.end(JSON.stringify({ error: message }))
}

// Seeded objects without a body serve a deterministic filler of their stored
// size, streamed, so a 50 MB dump downloads without the fixture holding it.
function writeFiller(res, key, size) {
  const unit = Buffer.from(`${key}\n`, "utf8")
  const chunk = Buffer.alloc(64 * 1024)
  for (let i = 0; i < chunk.length; i++) chunk[i] = unit[i % unit.length]
  let left = size
  while (left > 0) {
    const n = Math.min(left, chunk.length)
    res.write(n === chunk.length ? chunk : chunk.subarray(0, n))
    left -= n
  }
}

export async function handleTroveContent(req, res, url) {
  if (req.method !== "GET" && req.method !== "PUT") return sendContentError(res, 405, "Only GET and PUT are allowed here.", { Allow: "GET, PUT" })

  if (req.method === "GET") {
    const { ticket: t, error } = readTicket(url.searchParams.get("t"))
    if (error) return sendContentError(res, 403, error)
    if (t.o !== "download" && t.o !== "preview") return sendContentError(res, 403, "This ticket is not for reading.")
    const s = Object.hasOwn(state, t.s) ? state[t.s] : null
    const o = s?.buckets.get(t.b)?.objects.get(t.k)
    if (!o) return sendContentError(res, 404, "object not found")
    const name = t.k.slice(t.k.lastIndexOf("/") + 1)
    const headers = {
      "Content-Type": o.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
      "Cache-Control": "no-store",
    }
    const limit = t.o === "preview" && typeof t.l === "number" && t.l > 0 ? t.l : Infinity
    // Like Go: Content-Length only when no read middleware matches, because
    // the stored size is not the size of what comes out.
    const readsThrough = matchingRows(s, t.b, t.k).some((r) => r.direction !== "write")
    if (o.body) {
      const bytes = o.body.subarray(0, Math.min(o.body.length, limit))
      if (!readsThrough) headers["Content-Length"] = String(bytes.length)
      res.writeHead(200, headers)
      res.end(bytes)
      return
    }
    const size = Math.min(o.storedSize, limit)
    if (!readsThrough) headers["Content-Length"] = String(size)
    res.writeHead(200, headers)
    writeFiller(res, t.k, size)
    res.end()
    return
  }

  if (url.searchParams.has("t")) return sendContentError(res, 403, "Upload tickets go in the X-Trove-Ticket header, never in the URL.")
  const header = req.headers["x-trove-ticket"]
  if (typeof header !== "string" || header === "") return sendContentError(res, 403, "This upload has no X-Trove-Ticket header.")
  const { ticket: t, error } = readTicket(header)
  if (error) return sendContentError(res, 403, error)
  if (t.o !== "upload") return sendContentError(res, 403, "This ticket is not for uploading.")
  const s = Object.hasOwn(state, t.s) ? state[t.s] : null
  const b = s?.buckets.get(t.b)
  if (!b) return sendContentError(res, 404, "bucket not found")
  if (b.objects.has(t.k) && t.ow !== true) return sendContentError(res, 409, "An object with this key already exists.")
  const declared = typeof t.n === "number" ? t.n : 0
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > declared) {
      sendContentError(res, 413, "The body is larger than the size this upload was started with.")
      req.destroy()
      return
    }
    chunks.push(chunk)
  }
  // The fixture's stand-in for a scan provider: any key containing "eicar".
  if (/eicar/i.test(t.k)) return sendContentError(res, 422, "A content scan blocked this upload.")
  const body = Buffer.concat(chunks)
  const etag = createHash("md5").update(body).digest("hex")
  b.objects.set(t.k, {
    storedSize: body.length,
    etag,
    lastModified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    contentType: typeof t.ct === "string" && t.ct !== "" ? t.ct : null,
    storageClass: null,
    versionId: null,
    metadata: null,
    body,
  })
  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  res.end(JSON.stringify({ key: t.k, storedSize: body.length, etag }))
}
```

Update the file's header comment: content tickets are checked by shape here, and the content routes live in this file.

- [ ] **Step 4: Dispatch from server.mjs**

Change the trove import line to:

```js
import { createTroveHandlers, handleTroveContent, resetTrove, TROVE_CONTENT_PATH } from "./trove-fixtures.mjs"
```

and in the request handler, right before `if (url.pathname === "/" || url.pathname === "/health") {`, add:

```js
    if (url.pathname === TROVE_CONTENT_PATH) {
      return await handleTroveContent(req, res, url)
    }
```

- [ ] **Step 5: Run verify**

```bash
FIXTURE_PORT=18761 node packages/fixture-server/server.mjs > /tmp/trove-fixture.log 2>&1 &
sleep 1
node packages/fixture-server/verify.mjs http://localhost:18761
kill %1
```

Expected: every check passes. If an older trove check counted the `assets` bucket's objects and now fails because of `diagram.svg`, update that check to the new count and say so in the report.

- [ ] **Step 6: Commit**

```bash
bash /Users/rexraphael/Work/xraph/forge-dashboard/.superpowers/tools/commit-mine.sh \
  -m "feat(fixture-server): serve trove content through ticketed routes" -m "<a 2 to 5 line body, per Global Constraints>" \
  --whole packages/fixture-server/trove-fixtures.mjs \
  --shared packages/fixture-server/server.mjs:Trove \
  --shared packages/fixture-server/verify.mjs:trove
git show --stat HEAD
git show HEAD -- packages/fixture-server/server.mjs packages/fixture-server/verify.mjs
```

Expected: `server.mjs` shows only the import change and the three dispatch lines. Every hunk in `verify.mjs` must contain `trove`; if one of your hunks does not (a blank line between checks, say), merge it into a neighbouring line or add the word to a comment line in it, then rerun.

---

### Task 3: The listing

**Files:**
- Create: `src/listing.ts`, `src/components/object-listing.tsx`
- Modify: `src/pages/browser.tsx`, `test/lazy-chunks.test.ts`
- Test: `test/listing.test.tsx`

**Interfaces:**
- Consumes: `ObjectsList`, `ObjectRow` (Task 1), `browserHref`, `displayName`, `folderOf` (Task 1), `withStore`.
- Produces: `type ListingRow = { kind: "folder"; key: string } | { kind: "object"; key: string; object: ObjectRow }`; `mergePage(page: ObjectsList): ListingRow[]`; `listingCaption(objects: number, folders: number, more: boolean): string`; `useListing({ store, bucket, prefix })` returning `{ first: QueryState<ObjectsList>; rows: ListingRow[]; nextCursor: string | null; loadMore(): void; loadingMore: boolean; moreError?: ContractError }`; `ObjectListing({ store, bucket, prefix, selectedKey })`; `VIRTUAL_THRESHOLD = 200`.

- [ ] **Step 1: Write the failing tests**

`test/listing.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ContractError, PluginProvider, queryStore } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ObjectListing } from "../src/components/object-listing"
import { listingCaption, mergePage } from "../src/listing"
import type { ObjectRow, ObjectsList } from "../src/types"
import "./harness"

function o(key: string, extra: Partial<ObjectRow> = {}): ObjectRow {
  return { key, storedSize: 10, etag: "e1", lastModified: "2026-09-30T12:00:00Z", contentType: null, storageClass: null, ...extra }
}

function page(objects: ObjectRow[], prefixes: string[] | null, nextCursor: string | null = null, routed = false): ObjectsList {
  return { objects, prefixes, nextCursor, foldersSupported: prefixes !== null, routed }
}

/** Answers objects.list by cursor, and records every call's params. */
function listClient(pages: Record<string, ObjectsList>): { client: ScopedClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = []
  return {
    calls,
    client: {
      extension: "trove",
      query: async (intent: string, params?: Record<string, unknown>) => {
        if (intent !== "objects.list") throw new ContractError("NOT_FOUND", `no handler for intent "${intent}"`)
        calls.push(params ?? {})
        const cursor = typeof params?.cursor === "string" ? params.cursor : ""
        if (!(cursor in pages)) throw new ContractError("BAD_REQUEST", "cursor does not decode")
        return pages[cursor]
      },
      command: async () => {
        throw new ContractError("NOT_FOUND", "no commands here")
      },
    } as ScopedClient,
  }
}

function renderListing(client: ScopedClient, props: Partial<{ store: string; bucket: string; prefix: string; selectedKey: string }> = {}) {
  return render(
    <PluginProvider client={client}>
      <ObjectListing store={props.store ?? ""} bucket={props.bucket ?? "reports"} prefix={props.prefix ?? ""} selectedKey={props.selectedKey ?? ""} />
    </PluginProvider>,
  )
}

describe("mergePage and listingCaption", () => {
  it("merges folders and objects into one key order", () => {
    const rows = mergePage(page([o("a.txt"), o("c.txt")], ["b/", "d/"]))
    expect(rows.map((r) => `${r.kind}:${r.key}`)).toEqual(["object:a.txt", "folder:b/", "object:c.txt", "folder:d/"])
  })

  it("counts what is shown and never claims a total while there is more", () => {
    expect(listingCaption(12, 3, false)).toBe("12 objects, 3 folders")
    expect(listingCaption(1, 0, false)).toBe("1 object")
    expect(listingCaption(0, 1, false)).toBe("0 objects, 1 folder")
    expect(listingCaption(200, 14, true)).toBe("214 shown, more under this prefix")
  })
})

describe("ObjectListing", () => {
  it("sends no prefix or store for the root of the default store", async () => {
    const { client, calls } = listClient({ "": page([o("a.txt")], []) })
    renderListing(client)
    await screen.findByText("a.txt")
    expect(calls[0]).toEqual({ bucket: "reports" })
  })

  it("lists folders as links into the prefix and objects as links that select them", async () => {
    const { client } = listClient({ "": page([o("2026/summary.json", { storedSize: 4812 })], ["2026/09/"]) })
    renderListing(client, { prefix: "2026/" })
    const folder = await screen.findByRole("link", { name: "09/" })
    expect(folder.getAttribute("href")).toBe("/@trove/buckets/reports?prefix=2026%2F09%2F")
    const file = screen.getByRole("link", { name: "summary.json" })
    expect(file.getAttribute("href")).toBe("/@trove/buckets/reports?prefix=2026%2F&key=2026%2Fsummary.json")
    expect(screen.getByText("4,812 B").className).toContain("font-mono")
  })

  it("marks the selected object's row", async () => {
    const { client } = listClient({ "": page([o("a.txt"), o("b.txt")], []) })
    renderListing(client, { selectedKey: "b.txt" })
    const row = (await screen.findByText("b.txt")).closest("tr")!
    expect(row.getAttribute("data-state")).toBe("selected")
    expect(row.getAttribute("aria-selected")).toBe("true")
  })

  it("says so above the table when the store routes keys elsewhere", async () => {
    const { client } = listClient({ "": page([o("a.txt")], [], null, true) })
    renderListing(client)
    expect(await screen.findByText(/can miss objects/)).toBeTruthy()
  })

  it("shows the three empty states", async () => {
    const empty = listClient({ "": page([], []) })
    const { unmount } = renderListing(empty.client)
    expect(await screen.findByText("This bucket is empty")).toBeTruthy()
    unmount()
    queryStore.clear()

    const none = listClient({ "": page([], []) })
    const second = renderListing(none.client, { prefix: "2027/" })
    expect(await screen.findByText("Nothing under this prefix")).toBeTruthy()
    second.unmount()
    queryStore.clear()

    const folded = listClient({ "": page([], [], "c1"), c1: page([o("z.txt")], []) })
    renderListing(folded.client)
    expect(await screen.findByText("Nothing on this page")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(await screen.findByText("z.txt")).toBeTruthy()
  })

  it("appends the next page on Load more and keeps the caption honest", async () => {
    const { client, calls } = listClient({
      "": page([o("a.txt")], ["f/"], "c1"),
      c1: page([o("b.txt")], [], null),
    })
    renderListing(client)
    expect(await screen.findByText("2 shown, more under this prefix")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load more" }))
    expect(await screen.findByText("b.txt")).toBeTruthy()
    expect(calls[1]).toEqual({ bucket: "reports", cursor: "c1" })
    expect(screen.getByText("2 objects, 1 folder")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("keeps a failed Load more on the page with what it already shows", async () => {
    const { client } = listClient({ "": page([o("a.txt")], [], "broken") })
    renderListing(client)
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
    expect(await screen.findByText("Could not load more")).toBeTruthy()
    expect(screen.getByText("a.txt")).toBeTruthy()
  })

  it("reloads the pages it had loaded when the listing is invalidated", async () => {
    const pages: Record<string, ObjectsList> = {
      "": page([o("a.txt")], [], "c1"),
      c1: page([o("b.txt")], [], null),
    }
    const { client } = listClient(pages)
    renderListing(client)
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }))
    await screen.findByText("b.txt")
    pages[""] = page([o("a.txt")], [], "c2")
    pages.c2 = page([o("b2.txt")], [], null)
    act(() => queryStore.invalidate("trove", ["objects.list"]))
    expect(await screen.findByText("b2.txt")).toBeTruthy()
    await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull())
    expect(screen.getByText("a.txt")).toBeTruthy()
  })

  it("renders a window of rows, not every row, past the threshold", async () => {
    const many = Array.from({ length: 250 }, (_, i) => o(`k${String(i).padStart(3, "0")}`))
    const { client } = listClient({ "": page(many, []) })
    renderListing(client)
    expect(await screen.findByText("250 objects")).toBeTruthy()
    const table = screen.getByRole("table")
    const rendered = within(table).getAllByRole("link").length
    expect(rendered).toBeGreaterThan(0)
    expect(rendered).toBeLessThan(100)
  })
})
```

If `queryStore.invalidate` reruns the read synchronously enough that `act` warns, wrap the call in `await act(async () => { ... })` instead.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/listing.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `src/listing.ts`**

```ts
import { useEffect, useRef, useState } from "react"
import { usePluginClient, useQuery } from "@forge-go/dashboard-plugin"
import type { ContractError, QueryState } from "@forge-go/dashboard-plugin"
import { withStore } from "./store"
import type { ObjectRow, ObjectsList } from "./types"

export type ListingRow =
  | { kind: "folder"; key: string }
  | { kind: "object"; key: string; object: ObjectRow }

/** One page's folders and objects as a single list in key order. */
export function mergePage(page: ObjectsList): ListingRow[] {
  const folders: ListingRow[] = (page.prefixes ?? []).map((key) => ({ kind: "folder", key }))
  const objects: ListingRow[] = page.objects.map((object) => ({ kind: "object", key: object.key, object }))
  return [...folders, ...objects].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.kind === "folder" ? -1 : 1))
}

/** What the caption says. A count of what is shown, never a total. */
export function listingCaption(objects: number, folders: number, more: boolean): string {
  if (more) return `${objects + folders} shown, more under this prefix`
  const o = `${objects} ${objects === 1 ? "object" : "objects"}`
  if (folders === 0) return o
  return `${o}, ${folders} ${folders === 1 ? "folder" : "folders"}`
}

function listParams(store: string, bucket: string, prefix: string, cursor?: string): Record<string, unknown> {
  return withStore(store, {
    bucket,
    ...(prefix !== "" ? { prefix } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  })
}

export interface Listing {
  first: QueryState<ObjectsList>
  rows: ListingRow[]
  nextCursor: string | null
  loadMore: () => void
  loadingMore: boolean
  moreError?: ContractError
}

/**
 * One prefix's listing, page by page.
 *
 * The first page is a useQuery, so the `invalidates` on an upload, copy or
 * delete refresh it. Later pages come through the client and are kept here.
 * When the first page changes under them, the pages after it are read again
 * from its new cursor, as many as were loaded, so the operator keeps their
 * place and never sees a row that is gone. The caller keys this by store,
 * bucket and prefix, so a new prefix starts from nothing.
 */
export function useListing({ store, bucket, prefix }: { store: string; bucket: string; prefix: string }): Listing {
  const client = usePluginClient()
  const first = useQuery<ObjectsList>("objects.list", listParams(store, bucket, prefix))
  const [more, setMore] = useState<ObjectsList[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<ContractError | undefined>()
  const loadedCount = useRef(0)
  const seenFirst = useRef<ObjectsList | undefined>(undefined)

  useEffect(() => {
    loadedCount.current = more.length
  }, [more])

  useEffect(() => {
    const data = first.data
    if (data === undefined || data === seenFirst.current) return
    const previous = seenFirst.current
    seenFirst.current = data
    const count = loadedCount.current
    if (previous === undefined || count === 0) return
    let cancelled = false
    void (async () => {
      const pages: ObjectsList[] = []
      let cursor = data.nextCursor
      try {
        for (let i = 0; i < count && cursor !== null; i++) {
          const next = await client.query<ObjectsList>("objects.list", listParams(store, bucket, prefix, cursor))
          pages.push(next)
          cursor = next.nextCursor
        }
        if (!cancelled) {
          setMore(pages)
          setMoreError(undefined)
        }
      } catch (error) {
        if (!cancelled) {
          setMore(pages)
          setMoreError(error as ContractError)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [first.data, client, store, bucket, prefix])

  const last = more.length > 0 ? more[more.length - 1] : first.data
  const nextCursor = last?.nextCursor ?? null
  const rows = first.data ? [first.data, ...more].flatMap(mergePage) : []

  function loadMore() {
    if (nextCursor === null || loadingMore) return
    setLoadingMore(true)
    setMoreError(undefined)
    client
      .query<ObjectsList>("objects.list", listParams(store, bucket, prefix, nextCursor))
      .then((next) => setMore((pages) => [...pages, next]))
      .catch((error: ContractError) => setMoreError(error))
      .finally(() => setLoadingMore(false))
  }

  return { first, rows, nextCursor, loadMore, loadingMore, moreError }
}
```

If the package's lint flags a hook rule here (for example setState inside an effect), restructure minimally and keep the behaviour the tests pin; say what you changed in the report.

- [ ] **Step 4: Implement `src/components/object-listing.tsx`**

```tsx
import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { PluginLink } from "@forge-go/dashboard-plugin"
import { Alert, AlertDescription, AlertTitle } from "@forge-go/dashboard-kit/components/alert"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@forge-go/dashboard-kit/components/table"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { browserHref, displayName, folderOf } from "../browser-location"
import { listingCaption, useListing } from "../listing"
import type { ListingRow } from "../listing"
import { Bytes } from "./bytes"
import { SettledBoundary } from "./settled-boundary"

/** Past this many rows the table renders a window of them. */
export const VIRTUAL_THRESHOLD = 200
const ROW_HEIGHT = 37

export function ObjectListing({
  store,
  bucket,
  prefix,
  selectedKey,
}: {
  store: string
  bucket: string
  prefix: string
  selectedKey: string
}) {
  const listing = useListing({ store, bucket, prefix })
  return (
    <SettledBoundary title="Could not list this bucket" query={listing.first} skeletonRows={6}>
      {(first) => <ListingBody listing={listing} routed={first.routed} store={store} bucket={bucket} prefix={prefix} selectedKey={selectedKey} />}
    </SettledBoundary>
  )
}

function ListingBody({
  listing,
  routed,
  store,
  bucket,
  prefix,
  selectedKey,
}: {
  listing: ReturnType<typeof useListing>
  routed: boolean
  store: string
  bucket: string
  prefix: string
  selectedKey: string
}) {
  const { rows, nextCursor, loadMore, loadingMore, moreError } = listing
  const folder = folderOf(prefix)
  const scroller = useRef<HTMLDivElement>(null)
  const virtual = rows.length > VIRTUAL_THRESHOLD
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    // jsdom measures nothing; a starting size gives tests a real window.
    initialRect: { width: 0, height: 600 },
  })

  const objects = rows.filter((r) => r.kind === "object").length
  const folders = rows.length - objects
  const more = nextCursor !== null

  const loadMoreControls = (
    <div className="flex flex-col gap-2">
      <CommandAlert error={moreError} title="Could not load more" />
      {more ? (
        <div>
          <Button variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  )

  const routedNote = routed ? (
    <Alert>
      <AlertTitle>Some keys may live on another backend</AlertTitle>
      <AlertDescription>
        This store routes some keys to other backends. This listing reads one backend, so it can miss objects even when there is nothing more to load.
      </AlertDescription>
    </Alert>
  ) : null

  if (rows.length === 0) {
    let empty = <EmptyState title="This bucket is empty" description="Drop files here, or use Upload files, to add the first object." />
    if (more) {
      empty = <EmptyState title="Nothing on this page" description="This page held no keys to show, but the driver has more to list." />
    } else if (prefix !== "") {
      empty = <EmptyState title="Nothing under this prefix" description={`No key in ${bucket} starts with ${prefix}.`} />
    }
    return (
      <div className="flex flex-col gap-3">
        {routedNote}
        {empty}
        {loadMoreControls}
      </div>
    )
  }

  const items = virtual ? virtualizer.getVirtualItems() : null
  const visible: { row: ListingRow; index: number }[] = items
    ? items.map((item) => ({ row: rows[item.index], index: item.index }))
    : rows.map((row, index) => ({ row, index }))
  const padTop = items && items.length > 0 ? items[0].start : 0
  const padBottom = items && items.length > 0 ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  return (
    <div className="flex flex-col gap-3">
      {routedNote}
      <div ref={scroller} className="overflow-auto" style={virtual ? { height: "60vh" } : undefined}>
        <Table>
          <TableCaption>{listingCaption(objects, folders, more)}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Stored size</TableHead>
              <TableHead>Last modified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {padTop > 0 ? (
              <tr aria-hidden="true" style={{ height: padTop }} />
            ) : null}
            {visible.map(({ row, index }) =>
              row.kind === "folder" ? (
                <TableRow key={`f:${row.key}`} data-index={index}>
                  <TableCell className="font-mono text-xs font-medium">
                    <PluginLink to={browserHref(bucket, { store, prefix: row.key })} className="hover:underline">
                      {displayName(row.key, folder)}
                    </PluginLink>
                  </TableCell>
                  <TableCell>
                    <NoneCell label="size" />
                  </TableCell>
                  <TableCell>
                    <NoneCell label="last modified" />
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow
                  key={`o:${row.key}`}
                  data-index={index}
                  data-state={row.key === selectedKey ? "selected" : undefined}
                  aria-selected={row.key === selectedKey}
                >
                  <TableCell className="font-mono text-xs font-medium">
                    <PluginLink to={browserHref(bucket, { store, prefix, key: row.key })} className="hover:underline">
                      <span className="block max-w-sm truncate" title={row.key}>
                        {displayName(row.key, folder)}
                      </span>
                    </PluginLink>
                  </TableCell>
                  <TableCell>
                    <Bytes value={row.object.storedSize} />
                  </TableCell>
                  <TableCell>
                    <Timestamp value={row.object.lastModified ?? undefined} label="last modified" />
                  </TableCell>
                </TableRow>
              ),
            )}
            {padBottom > 0 ? (
              <tr aria-hidden="true" style={{ height: padBottom }} />
            ) : null}
          </TableBody>
        </Table>
      </div>
      {loadMoreControls}
    </div>
  )
}
```

Check: `Bytes` renders with `font-mono text-xs` (it does in slice 3); if the test that reads `getByText("4,812 B").className` finds the class on a parent instead, assert on the element `Bytes` actually renders. If the link's accessible name includes the `title`, use `getByRole("link", { name: "summary.json" })` as written and adjust only the query, never the expectation of what text is shown.

- [ ] **Step 5: Mount the listing on the page**

In `src/pages/browser.tsx`, read `key` from `useBrowserLocation()` and render, below the path bar:

```tsx
      <ObjectListing key={`${store}\n${bucket}\n${prefix}`} store={store} bucket={bucket} prefix={prefix} selectedKey={key} />
```

with `import { ObjectListing } from "../components/object-listing"`.

Add to `test/lazy-chunks.test.ts`:

```ts
  it("names the virtualiser only in the listing, which only the browser page imports", () => {
    expect(namingFiles("@tanstack/react-virtual")).toEqual(["../src/components/object-listing.tsx"])
    const importers = Object.entries(modules)
      .filter(([, mod]) => /from\s+["'][./]*components\/object-listing["']/.test(sourceOf(mod)))
      .map(([path]) => path)
    expect(importers).toEqual(["../src/pages/browser.tsx"])
  })
```

- [ ] **Step 6: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass. The browser-page tests from Task 1 now also need `objects.list` in their stub maps; add `"objects.list": { objects: [], prefixes: [], nextCursor: null, foldersSupported: true, routed: false }` to each.

- [ ] **Step 7: Commit**

`git add` the new files, then `git commit --only -m "feat(plugin-trove): list a bucket by prefix with folders and Load more" -m "<a 2 to 5 line body, per Global Constraints>" -- <every file you changed>`, then `git show --stat HEAD`.

---

### Task 4: The inspector, Download and Copy key

**Files:**
- Create: `src/content.ts`, `src/components/inspector.tsx`
- Modify: `src/pages/browser.tsx`, `test/harness.tsx`
- Test: `test/fixtures.ts` (new, shared `HEAD`), `test/inspector.test.tsx`, modify `test/browser-page.test.tsx`

**Interfaces:**
- Consumes: `ObjectHead`, `ContentLink`, `withStore`, `Bytes`, `SettledBoundary`.
- Produces: `downloadObject(client: ScopedClient, store: string, bucket: string, key: string): Promise<void>`; `class ContentRouteError extends Error { status: number }`; `Inspector({ store, bucket, objectKey, children? })` where `children` is a render slot `(head: ObjectHead) => ReactNode` the next tasks fill; `renderPageWithNavigation(Page, client, params, navigate)` in the harness.

- [ ] **Step 1: Add a harness helper for navigation**

Append to `test/harness.tsx`:

```tsx
/**
 * Like renderPage, inside a NavigationProvider whose navigate is `navigate`,
 * so a test can see where a page sends the operator. Links render as plain
 * anchors with the resolved href.
 */
export function renderPageWithNavigation(
  Page: ComponentType<PluginPageProps>,
  client: ScopedClient,
  params: PluginPageProps["params"],
  navigate: (to: string) => void,
) {
  return render(
    <NavigationProvider
      value={{
        Link: ({ to, children, className, ...rest }) => (
          <a href={to} className={className} {...rest}>
            {children}
          </a>
        ),
        navigate,
      }}
    >
      <PluginProvider client={client}>
        <Page params={params} />
      </PluginProvider>
    </NavigationProvider>,
  )
}
```

with `NavigationProvider` added to the harness's import from `@forge-go/dashboard-plugin`.

- [ ] **Step 2: Write the failing tests**

`test/fixtures.ts` (shared by the inspector, actions and preview tests):

```ts
import type { ObjectHead } from "../src/types"

export const HEAD: ObjectHead = {
  object: {
    key: "2026/09/summary.json",
    storedSize: 4812,
    etag: "9f3a01",
    lastModified: "2026-09-30T11:58:00Z",
    contentType: "application/json",
    storageClass: null,
    versionId: null,
    metadata: { owner: "ops", team: "billing" },
  },
  middleware: [{ name: "compress", direction: "readwrite", scope: "global", priority: 0 }],
  presign: { available: false, reason: "No share links: this driver cannot sign one." },
}
```

`test/inspector.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { Inspector } from "../src/components/inspector"
import { HEAD } from "./fixtures"
import { recordingQueryClient, stubClient } from "./harness"

function renderInspector(client: ScopedClient, objectKey = HEAD.object.key) {
  return render(
    <PluginProvider client={client}>
      <Inspector store="" bucket="reports" objectKey={objectKey} />
    </PluginProvider>,
  )
}

describe("Inspector", () => {
  let click: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
  })
  afterEach(() => {
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it("shows what objects.head reports, with identifiers in mono and absences as none", async () => {
    renderInspector(stubClient({ "objects.head": HEAD }))
    expect(await screen.findByRole("heading", { name: "2026/09/summary.json" })).toBeTruthy()
    expect(screen.getByText("9f3a01").className).toContain("font-mono")
    expect(screen.getByText("application/json").className).toContain("font-mono")
    expect(screen.getByText("owner=ops")).toBeTruthy()
    expect(screen.getByText("team=billing")).toBeTruthy()
    expect(screen.getAllByText(/none/i).length).toBeGreaterThan(0)
  })

  it("words middleware as what matches now, never as what happened to the object", async () => {
    renderInspector(stubClient({ "objects.head": HEAD }))
    expect(await screen.findByText("compress")).toBeTruthy()
    expect(screen.getByText(/current config/)).toBeTruthy()
    expect(screen.getByText(/records nothing about how this object was written/)).toBeTruthy()
    expect(screen.queryByText(/is compressed|was compressed|encrypted/i)).toBeNull()
  })

  it("says when nothing matches the key now", async () => {
    renderInspector(stubClient({ "objects.head": { ...HEAD, middleware: [] } }))
    expect(await screen.findByText("No middleware matches this key in the current config.")).toBeTruthy()
  })

  it("asks for a download link only when Download is clicked", async () => {
    const { client, sent } = recordingQueryClient({
      "objects.head": HEAD,
      "objects.contentUrl": { url: "/dashboard/trove/content?t=abc", expiresAt: "2026-09-30T12:01:00Z" },
    })
    renderInspector(client)
    await screen.findByRole("heading", { name: "2026/09/summary.json" })
    expect(sent.some((s) => s.intent === "objects.contentUrl")).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(sent.find((s) => s.intent === "objects.contentUrl")?.params).toEqual({
      bucket: "reports",
      key: "2026/09/summary.json",
      purpose: "download",
    })
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.getAttribute("href")).toBe("/dashboard/trove/content?t=abc")
    expect(anchor.hasAttribute("download")).toBe(true)
  })

  it("shows why a download could not start", async () => {
    const client = {
      extension: "trove",
      query: async (intent: string) => {
        if (intent === "objects.head") return HEAD
        throw new ContractError("NOT_FOUND", "object not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderInspector(client)
    fireEvent.click(await screen.findByRole("button", { name: "Download" }))
    expect(await screen.findByText("Could not start the download")).toBeTruthy()
  })

  it("copies the full key", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    renderInspector(stubClient({ "objects.head": HEAD }))
    fireEvent.click(await screen.findByRole("button", { name: "Copy key" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("2026/09/summary.json"))
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy()
  })

  it("reads as gone when the object no longer exists", async () => {
    const client = {
      extension: "trove",
      query: async () => {
        throw new ContractError("NOT_FOUND", "object not found")
      },
      command: async () => undefined,
    } as unknown as ScopedClient
    renderInspector(client)
    expect(await screen.findByText("This object is gone")).toBeTruthy()
  })
})
```

Add to `test/browser-page.test.tsx`:

```tsx
  it("asks the operator to pick an object until a key is selected", () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports")
    renderPage(BrowserPage, stubClient({ "objects.list": EMPTY_LIST }), { bucket: "reports" })
    expect(screen.getByText("Select an object to see it here.")).toBeTruthy()
  })

  it("opens the inspector for the key in the URL", async () => {
    window.history.replaceState(null, "", "/@trove/buckets/reports?key=readme.txt")
    renderPage(BrowserPage, stubClient({ "objects.list": EMPTY_LIST, "objects.head": { ...HEAD, object: { ...HEAD.object, key: "readme.txt" } } }), { bucket: "reports" })
    expect(await screen.findByRole("heading", { name: "readme.txt" })).toBeTruthy()
  })
```

with `const EMPTY_LIST = { objects: [], prefixes: [], nextCursor: null, foldersSupported: true, routed: false }` and `import { HEAD } from "./fixtures"`.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/inspector.test.tsx test/browser-page.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/content.ts`**

```ts
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { withStore } from "./store"
import type { ContentLink } from "./types"

/** A failure from the content route itself, with its HTTP status (0 when it never answered). */
export class ContentRouteError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = "ContentRouteError"
    this.status = status
  }
}

/**
 * Starts a download. The link is minted here, at the click, because a
 * download ticket lives 60 seconds. A plain anchor with `download` is enough:
 * the route always answers `Content-Disposition: attachment`, and the ticket
 * in `?t=` is what authorises it.
 */
export async function downloadObject(client: ScopedClient, store: string, bucket: string, key: string): Promise<void> {
  const link = await client.query<ContentLink>("objects.contentUrl", withStore(store, { bucket, key, purpose: "download" }))
  const anchor = document.createElement("a")
  anchor.href = link.url
  anchor.setAttribute("download", "")
  anchor.rel = "noopener"
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}
```

- [ ] **Step 5: Implement `src/components/inspector.tsx`**

```tsx
import { useState } from "react"
import type { ReactNode } from "react"
import { useQuery, usePluginClient } from "@forge-go/dashboard-plugin"
import type { ContractError } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { DescriptionList } from "@forge-go/dashboard-kit/components/detail-layout"
import { EmptyState } from "@forge-go/dashboard-kit/components/empty-state"
import { NoneCell } from "@forge-go/dashboard-kit/components/none-cell"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { TagList } from "@forge-go/dashboard-kit/components/tag-list"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { downloadObject } from "../content"
import { withStore } from "../store"
import type { ObjectHead } from "../types"
import { Bytes } from "./bytes"
import { SettledBoundary } from "./settled-boundary"

function Mono({ value, label }: { value: string | null; label: string }) {
  return value ? <span className="font-mono text-xs break-all">{value}</span> : <NoneCell label={label} />
}

/**
 * One object, as `objects.head` reports it. `children` renders below the
 * fields with the same head, for the preview and the commands.
 */
export function Inspector({
  store,
  bucket,
  objectKey,
  children,
}: {
  store: string
  bucket: string
  objectKey: string
  children?: (head: ObjectHead) => ReactNode
}) {
  const head = useQuery<ObjectHead>("objects.head", withStore(store, { bucket, key: objectKey }))

  if (head.error?.code === "NOT_FOUND" && head.data === undefined) {
    return <EmptyState title="This object is gone" description="Nothing is stored under this key now. It may have been deleted since the listing was read." />
  }

  return (
    <SettledBoundary title="Could not read this object" query={head} skeletonRows={6}>
      {(data) => (
        <section className="flex flex-col gap-4">
          <h2 className="font-mono text-xs font-medium break-all">{data.object.key}</h2>
          <InspectorActions store={store} bucket={bucket} objectKey={data.object.key} />
          <DescriptionList
            items={[
              { term: "Stored size", value: <Bytes value={data.object.storedSize} /> },
              { term: "ETag", value: <Mono value={data.object.etag} label="ETag" /> },
              { term: "Content type", value: <Mono value={data.object.contentType} label="content type" /> },
              { term: "Storage class", value: <Mono value={data.object.storageClass} label="storage class" /> },
              { term: "Version", value: <Mono value={data.object.versionId} label="version" /> },
              { term: "Last modified", value: <Timestamp value={data.object.lastModified ?? undefined} label="last modified" /> },
              {
                term: "Metadata",
                value: data.object.metadata && Object.keys(data.object.metadata).length > 0 ? (
                  <TagList
                    label="metadata"
                    values={Object.entries(data.object.metadata)
                      .sort(([a], [b]) => (a < b ? -1 : 1))
                      .map(([k, v]) => `${k}=${v}`)}
                  />
                ) : (
                  <NoneCell label="metadata" />
                ),
              },
              {
                term: "Applies now",
                value:
                  data.middleware.length > 0 ? (
                    <TagList label="middleware" values={data.middleware.map((m) => m.name)} />
                  ) : (
                    <span className="text-sm">No middleware matches this key in the current config.</span>
                  ),
              },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Applies now is what matches this key in the current config. Stored size is the bytes as stored. Trove records nothing about how this object was written.
          </p>
          {children ? children(data) : null}
        </section>
      )}
    </SettledBoundary>
  )
}

function InspectorActions({ store, bucket, objectKey }: { store: string; bucket: string; objectKey: string }) {
  const client = usePluginClient()
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<ContractError | undefined>()
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle")

  async function download() {
    setDownloading(true)
    setDownloadError(undefined)
    try {
      await downloadObject(client, store, bucket, objectKey)
    } catch (error) {
      setDownloadError(error as ContractError)
    } finally {
      setDownloading(false)
    }
  }

  async function copyKey() {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard")
      await navigator.clipboard.writeText(objectKey)
      setCopied("copied")
      window.setTimeout(() => setCopied("idle"), 2000)
    } catch {
      setCopied("failed")
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={downloading} onClick={() => void download()}>
          {downloading ? "Starting…" : "Download"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void copyKey()}>
          {copied === "copied" ? "Copied" : "Copy key"}
        </Button>
      </div>
      <CommandAlert error={downloadError} title="Could not start the download" />
      {copied === "failed" ? (
        <p className="text-xs text-destructive">Copying needs a secure page (HTTPS or localhost) and clipboard permission.</p>
      ) : null}
    </div>
  )
}
```

Note: `downloadObject` can throw a plain error only if the anchor fails, which it does not; the `ContractError` cast is for the query's rejection.

- [ ] **Step 6: Lay out the page in two resizable panels**

In `src/pages/browser.tsx`, replace the bare listing with:

```tsx
      <ResizablePanelGroup orientation="horizontal" className="min-h-96 rounded-md border">
        <ResizablePanel defaultSize="62" minSize="35">
          <div className="flex h-full flex-col gap-3 p-3">
            <ObjectListing key={`${store}\n${bucket}\n${prefix}`} store={store} bucket={bucket} prefix={prefix} selectedKey={key} />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="38" minSize="25">
          <div className="h-full overflow-auto p-3">
            {key !== "" ? (
              <Inspector key={`${store}\n${bucket}\n${key}`} store={store} bucket={bucket} objectKey={key} />
            ) : (
              <p className="text-sm text-muted-foreground">Select an object to see it here.</p>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
```

Import `ResizableHandle, ResizablePanel, ResizablePanelGroup` from `@forge-go/dashboard-kit/components/resizable` and `Inspector` from `../components/inspector`. Read `resizable.tsx`: if `ResizableHandle` has no `withHandle` prop, drop it. Run the class check on `min-h-96`, `h-full`, `overflow-auto`, `p-3`, `rounded-md`, `border`; swap any that are not generated.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass.

- [ ] **Step 8: Commit**

`git add` the new files, then `git commit --only -m "feat(plugin-trove): inspect an object and download it on demand" -m "<a 2 to 5 line body, per Global Constraints>" -- <every file you changed>`, then `git show --stat HEAD`.

---

### Task 5: Share link, Copy to and Delete

**Files:**
- Create: `src/components/object-actions.tsx`
- Modify: `src/pages/browser.tsx`
- Test: `test/object-actions.test.tsx`

**Interfaces:**
- Consumes: `ObjectHead`, `ContentLink`, `ObjectRow`, `BucketsList`, `CasStatus`, `browserHref`, `folderOf`, `withStore`, `renderPageWithNavigation`.
- Produces: `ObjectActions({ store, bucket, prefix, head, casBucket }: { ...; casBucket: string | null })`.

- [ ] **Step 1: Write the failing tests**

`test/object-actions.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ContractError, NavigationProvider, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { ObjectActions } from "../src/components/object-actions"
import type { ObjectHead } from "../src/types"
import { HEAD } from "./fixtures"
import { recordingCommandClient } from "./harness"

const BUCKETS = { buckets: [{ name: "reports", createdAt: null }, { name: "assets", createdAt: null }], createdAtMeaning: "modified" }

function renderActions(client: ScopedClient, head: ObjectHead = HEAD, casBucket: string | null = "cas", navigate = vi.fn()) {
  render(
    <NavigationProvider value={{ Link: ({ to, children }) => <a href={to}>{children}</a>, navigate }}>
      <PluginProvider client={client}>
        <ObjectActions store="" bucket="reports" prefix="2026/09/" head={head} casBucket={casBucket} />
      </PluginProvider>
    </NavigationProvider>,
  )
  return navigate
}

function throwing(intent: string, error: ContractError, answers: Record<string, unknown> = {}): ScopedClient {
  const sent: { intent: string; payload: unknown }[] = []
  return {
    extension: "trove",
    query: async (i: string) => {
      if (i in answers) return answers[i]
      throw new ContractError("NOT_FOUND", `no handler for intent "${i}"`)
    },
    command: async (i: string, payload: unknown) => {
      sent.push({ intent: i, payload })
      if (i === intent && sent.filter((s) => s.intent === intent).length === 1) throw error
      return { key: "2026/09/summary.json", storedSize: 1, etag: null, lastModified: null, contentType: null, storageClass: null }
    },
    sent,
  } as unknown as ScopedClient
}

describe("Share link", () => {
  it("gives the reason when the driver cannot sign", () => {
    renderActions(recordingCommandClient({}).client)
    expect(screen.queryByRole("button", { name: "Share link" })).toBeNull()
    expect(screen.getByText(/this driver cannot sign one/)).toBeTruthy()
  })

  it("creates a link for the chosen lifetime and shows when it expires", async () => {
    const { client, sent } = recordingCommandClient({}, { "objects.presign": { url: "https://s3.example/x?sig=1", expiresAt: "2026-09-30T13:00:00Z" } })
    renderActions(client, { ...HEAD, presign: { available: true, reason: null } })
    fireEvent.click(screen.getByRole("button", { name: "Share link" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(/cannot revoke it/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole("button", { name: "Create link" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "objects.presign", payload: { bucket: "reports", key: "2026/09/summary.json", expiresSeconds: 3600 } }]))
    expect(((await within(dialog).findByLabelText("Share link URL")) as HTMLInputElement).value).toBe("https://s3.example/x?sig=1")
  })
})

describe("Copy to", () => {
  it("copies to the chosen bucket and key", async () => {
    const { client, sent } = recordingCommandClient({ "buckets.list": BUCKETS }, { "objects.copy": { key: "copy.json", storedSize: 1, etag: null, lastModified: null, contentType: null, storageClass: null } })
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Copy to" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(await within(dialog).findByLabelText("Destination bucket"), { target: { value: "assets" } })
    fireEvent.change(within(dialog).getByLabelText("Destination key"), { target: { value: "copy.json" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    await waitFor(() =>
      expect(sent).toEqual([
        { intent: "objects.copy", payload: { srcBucket: "reports", srcKey: "2026/09/summary.json", dstBucket: "assets", dstKey: "copy.json", overwrite: false } },
      ]),
    )
    const link = await screen.findByRole("link", { name: "assets/copy.json" })
    expect(link.getAttribute("href")).toBe("/@trove/buckets/assets?key=copy.json")
  })

  it("asks before replacing an existing object, then sends overwrite", async () => {
    const client = throwing("objects.copy", new ContractError("CONFLICT", "an object with this key already exists", { exists: true }), { "buckets.list": BUCKETS })
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Copy to" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Destination key"), { target: { value: "taken.json" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    const replace = await within(dialog).findByLabelText("Replace the existing object")
    fireEvent.click(replace)
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy" }))
    const sent = (client as unknown as { sent: { intent: string; payload: { overwrite: boolean } }[] }).sent
    await waitFor(() => expect(sent.map((s) => s.payload.overwrite)).toEqual([false, true]))
  })

  it("will not copy an object onto itself", async () => {
    const { client } = recordingCommandClient({ "buckets.list": BUCKETS })
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Copy to" }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByLabelText("Destination bucket")
    expect((within(dialog).getByRole("button", { name: "Copy" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("Delete", () => {
  it("deletes and goes back to the prefix", async () => {
    const { client, sent } = recordingCommandClient({}, { "objects.delete": { key: "2026/09/summary.json" } })
    const navigate = renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(sent).toEqual([{ intent: "objects.delete", payload: { bucket: "reports", key: "2026/09/summary.json" } }]))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/@trove/buckets/reports?prefix=2026%2F09%2F"))
  })

  it("says up front that the CAS bucket refuses, and does not send the command", async () => {
    const { client, sent } = recordingCommandClient({})
    render(
      <PluginProvider client={client}>
        <ObjectActions store="" bucket="cas" prefix="" head={HEAD} casBucket="cas" />
      </PluginProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText(/CAS manages this bucket/)).toBeTruthy()
    expect((within(dialog).getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true)
    expect(sent).toEqual([])
  })

  it("keeps a refusal inside the dialog", async () => {
    const client = throwing("objects.delete", new ContractError("CONFLICT", "CAS manages the cas bucket."))
    renderActions(client)
    fireEvent.click(screen.getByRole("button", { name: "Delete" }))
    const dialog = await screen.findByRole("alertdialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }))
    expect(await within(dialog).findByText("Could not delete the object")).toBeTruthy()
  })
})
```

`HEAD` comes from `test/fixtures.ts`, which Task 4 created.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/object-actions.test.tsx`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `src/components/object-actions.tsx`**

```tsx
import { useState } from "react"
import type { FormEvent } from "react"
import { PluginLink, useCommand, useNavigateTo, useQuery } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Checkbox } from "@forge-go/dashboard-kit/components/checkbox"
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
import { NativeSelect, NativeSelectOption } from "@forge-go/dashboard-kit/components/native-select"
import { CommandAlert } from "@forge-go/dashboard-kit/components/query-boundary"
import { Timestamp } from "@forge-go/dashboard-kit/components/timestamp"
import { browserHref, folderOf } from "../browser-location"
import { withStore } from "../store"
import type { BucketsList, ContentLink, ObjectHead, ObjectRow } from "../types"

const LIFETIMES = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 86400, label: "1 day" },
  { seconds: 604800, label: "7 days" },
]

export function ObjectActions({
  store,
  bucket,
  prefix,
  head,
  casBucket,
}: {
  store: string
  bucket: string
  prefix: string
  head: ObjectHead
  /** The CAS bucket when CAS is on, otherwise null. */
  casBucket: string | null
}) {
  const [open, setOpen] = useState<"share" | "copy" | "delete" | null>(null)
  const key = head.object.key
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {head.presign.available ? (
          <Button size="sm" variant="outline" onClick={() => setOpen("share")}>
            Share link
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => setOpen("copy")}>
          Copy to
        </Button>
        <Button size="sm" variant="destructive" onClick={() => setOpen("delete")}>
          Delete
        </Button>
      </div>
      {!head.presign.available ? (
        <p className="text-xs text-muted-foreground">{head.presign.reason ?? "Share links are not available for this object."}</p>
      ) : null}
      {open === "share" ? <ShareDialog store={store} bucket={bucket} objectKey={key} onClose={() => setOpen(null)} /> : null}
      {open === "copy" ? <CopyDialog store={store} bucket={bucket} objectKey={key} onClose={() => setOpen(null)} /> : null}
      <DeleteDialog
        open={open === "delete"}
        store={store}
        bucket={bucket}
        prefix={prefix}
        objectKey={key}
        refused={casBucket !== null && casBucket === bucket}
        onClose={() => setOpen(null)}
      />
    </div>
  )
}

function ShareDialog({ store, bucket, objectKey, onClose }: { store: string; bucket: string; objectKey: string; onClose: () => void }) {
  const presign = useCommand<ContentLink>("objects.presign")
  const [seconds, setSeconds] = useState(3600)

  async function submit(event: FormEvent) {
    event.preventDefault()
    await presign.execute(withStore(store, { bucket, key: objectKey, expiresSeconds: seconds }))
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !presign.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Share link</DialogTitle>
            <DialogDescription>
              Anyone with this link can download the object until it expires. The link goes straight to the storage backend, so the dashboard cannot revoke it.
            </DialogDescription>
          </DialogHeader>
          <CommandAlert error={presign.error} title="Could not create the link" />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-lifetime">Expires after</Label>
            <NativeSelect id="share-lifetime" value={String(seconds)} onChange={(e) => setSeconds(Number(e.target.value))}>
              {LIFETIMES.map((l) => (
                <NativeSelectOption key={l.seconds} value={String(l.seconds)}>
                  {l.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {presign.data ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="share-url">Link</Label>
              <Input id="share-url" aria-label="Share link URL" readOnly className="font-mono text-xs" value={presign.data.url} onFocus={(e) => e.target.select()} />
              <p className="text-xs text-muted-foreground">
                Expires <Timestamp value={presign.data.expiresAt} label="expiry" />
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={presign.loading} onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={presign.loading}>
              {presign.loading ? "Creating…" : "Create link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CopyDialog({ store, bucket, objectKey, onClose }: { store: string; bucket: string; objectKey: string; onClose: () => void }) {
  const buckets = useQuery<BucketsList>("buckets.list", withStore(store, {}))
  const copy = useCommand<ObjectRow>("objects.copy")
  const [dstBucket, setDstBucket] = useState(bucket)
  const [dstKey, setDstKey] = useState(objectKey)
  const [overwrite, setOverwrite] = useState(false)
  const [done, setDone] = useState<{ bucket: string; key: string } | null>(null)
  const exists = copy.error?.code === "CONFLICT" && copy.error.details?.exists === true
  const same = dstBucket === bucket && dstKey === objectKey
  const canSubmit = dstKey !== "" && !same && !copy.loading

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    const result = await copy.execute(withStore(store, { srcBucket: bucket, srcKey: objectKey, dstBucket, dstKey, overwrite }))
    if (result !== undefined) setDone({ bucket: dstBucket, key: dstKey })
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !copy.loading && onClose()}>
      <DialogContent>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Copy to</DialogTitle>
            <DialogDescription>Trove reads the object and writes it again under the new key. Copies within this store only.</DialogDescription>
          </DialogHeader>
          {exists ? null : <CommandAlert error={copy.error} title="Could not copy the object" />}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-bucket">Destination bucket</Label>
            <NativeSelect id="copy-bucket" value={dstBucket} onChange={(e) => setDstBucket(e.target.value)}>
              {(buckets.data?.buckets ?? [{ name: bucket, createdAt: null }]).map((b) => (
                <NativeSelectOption key={b.name} value={b.name}>
                  {b.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="copy-key">Destination key</Label>
            <Input id="copy-key" className="font-mono text-xs" autoComplete="off" spellCheck={false} value={dstKey} onChange={(e) => setDstKey(e.target.value)} />
          </div>
          {exists ? (
            <div className="flex items-center gap-2">
              <Checkbox id="copy-overwrite" checked={overwrite} onCheckedChange={(v) => setOverwrite(v === true)} />
              <Label htmlFor="copy-overwrite">Replace the existing object</Label>
            </div>
          ) : null}
          {same ? <p className="text-xs text-muted-foreground">Pick a different bucket or key.</p> : null}
          {done ? (
            <p className="text-sm">
              Copied to{" "}
              <PluginLink to={browserHref(done.bucket, { store, prefix: folderOf(done.key), key: done.key })} className="font-mono text-xs hover:underline">
                {`${done.bucket}/${done.key}`}
              </PluginLink>
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={copy.loading} onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {copy.loading ? "Copying…" : "Copy"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({
  open,
  store,
  bucket,
  prefix,
  objectKey,
  refused,
  onClose,
}: {
  open: boolean
  store: string
  bucket: string
  prefix: string
  objectKey: string
  refused: boolean
  onClose: () => void
}) {
  const remove = useCommand<{ key: string }>("objects.delete")
  const navigate = useNavigateTo()
  const [opened, setOpened] = useState(false)
  if (open && !opened) {
    setOpened(true)
    remove.reset()
  }
  if (!open && opened) setOpened(false)

  async function confirm() {
    const result = await remove.execute(withStore(store, { bucket, key: objectKey }))
    if (result === undefined) return
    onClose()
    navigate(browserHref(bucket, { store, prefix }))
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => !next && !remove.loading && onClose()}
      title={`Delete ${objectKey}?`}
      description={
        refused
          ? "CAS manages this bucket, so Trove refuses to delete its objects here. Deleting one would leave the CAS index pointing at nothing."
          : "Trove deletes the key on the driver. There is no undo, and a key that is already gone counts as deleted."
      }
      confirmLabel="Delete"
      pending={remove.loading}
      confirmDisabled={refused}
      onConfirm={() => void confirm()}
    >
      <CommandAlert error={remove.error} title="Could not delete the object" />
    </ConfirmDialog>
  )
}
```

The `opened` flag calls `reset()` the render the dialog opens, which is what the constraint "reset when a dialog OPENS" asks. If the package lint forbids setState during render here, use the pattern `packages/plugin-trove/src/pages/buckets.tsx` uses for its delete dialog (reset in the click handler that opens it), passing `remove` up to `ObjectActions` if needed.

The copy-to success link: `browserHref(done.bucket, { store, prefix: folderOf(done.key), key: done.key })` gives `?key=copy.json` for a top-level key, which is what the test expects. Check `Checkbox`'s `onCheckedChange` signature in `packages/kit/src/components/checkbox.tsx` (Base UI) and adapt the handler, not the behaviour.

- [ ] **Step 4: Wire it into the inspector on the page**

In `src/pages/browser.tsx`, read CAS status once:

```tsx
  const cas = useQuery<CasStatus>("cas.status", withStore(store, {}))
  const casBucket = cas.data?.enabled ? cas.data.bucket : null
```

and pass a render slot to the inspector:

```tsx
              <Inspector key={`${store}\n${bucket}\n${key}`} store={store} bucket={bucket} objectKey={key}>
                {(head) => <ObjectActions store={store} bucket={bucket} prefix={prefix} head={head} casBucket={casBucket} />}
              </Inspector>
```

Every `test/browser-page.test.tsx` stub map now needs `"cas.status": { enabled: false, algorithm: null, bucket: null, index: null, resetsOnRestart: false, releaseSupported: false }`.

- [ ] **Step 5: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass.

- [ ] **Step 6: Commit**

`git add` the new files, then `git commit --only -m "feat(plugin-trove): share, copy and delete an object from the inspector" -m "<a 2 to 5 line body, per Global Constraints>" -- <every file you changed>`, then `git show --stat HEAD`.

---

### Task 6: Previews and the lazy CodeMirror view

**Files:**
- Create: `src/components/code-view.tsx`, `src/components/preview.tsx`
- Modify: `src/content.ts`, `src/pages/browser.tsx`, `test/lazy-chunks.test.ts`
- Test: `test/preview.test.tsx`

**Interfaces:**
- Consumes: `ContentLink`, `ObjectHead`, `ContentRouteError`, `withStore`.
- Produces: `previewKind(contentType: string | null): "json" | "text" | "image" | "none"`; `PREVIEW_LIMIT = 262144`; `IMAGE_PREVIEW_MAX = 4194304`; `fetchContent(url: string): Promise<ArrayBuffer>`; `Preview({ store, bucket, head })`; `CodeView` (default export) `({ text, language, label }: { text: string; language: "json" | "text"; label: string })`.

Ruling recorded in the plan: images use a download ticket, not a preview ticket, because a preview ticket stops at 256 KiB and a cut image does not render. The spec's protection (never inline from the route; a Blob behind an object URL in an `<img>`) is unchanged. Images over 4 MiB as stored are not previewed.

- [ ] **Step 1: Write the failing tests**

`test/preview.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PluginProvider } from "@forge-go/dashboard-plugin"
import { Preview } from "../src/components/preview"
import { previewKind, PREVIEW_LIMIT } from "../src/content"
import type { ObjectHead } from "../src/types"
import { HEAD } from "./fixtures"
import { recordingQueryClient } from "./harness"

vi.mock("../src/components/code-view", () => ({
  default: ({ text, language }: { text: string; language: string }) => (
    <pre data-testid="code-view" data-language={language}>
      {text}
    </pre>
  ),
}))

const LINK = { url: "/dashboard/trove/content?t=abc", expiresAt: "2026-09-30T12:01:00Z" }

function headWith(contentType: string | null, storedSize = 100): ObjectHead {
  return { ...HEAD, object: { ...HEAD.object, contentType, storedSize } }
}

function respond(body: BodyInit, init: ResponseInit = { status: 200 }) {
  return vi.fn().mockResolvedValue(new Response(body, init))
}

function renderPreview(head: ObjectHead) {
  const recorded = recordingQueryClient({ "objects.contentUrl": LINK })
  render(
    <PluginProvider client={recorded.client}>
      <Preview store="" bucket="reports" head={head} />
    </PluginProvider>,
  )
  return recorded.sent
}

describe("previewKind", () => {
  it("sorts content types into what the preview can show", () => {
    expect(previewKind("application/json")).toBe("json")
    expect(previewKind("application/vnd.api+json; charset=utf-8")).toBe("json")
    expect(previewKind("text/plain")).toBe("text")
    expect(previewKind("text/csv")).toBe("text")
    expect(previewKind("application/x-yaml")).toBe("text")
    expect(previewKind("image/png")).toBe("image")
    expect(previewKind("image/svg+xml")).toBe("image")
    expect(previewKind("application/pdf")).toBe("none")
    expect(previewKind(null)).toBe("none")
  })
})

describe("Preview", () => {
  beforeEach(() => {
    // jsdom has neither; assign them for the duration of each test.
    URL.createObjectURL = vi.fn(() => "blob:preview")
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => vi.unstubAllGlobals())

  it("fetches a text preview through a preview ticket and pretty-prints whole JSON", async () => {
    vi.stubGlobal("fetch", respond('{"total":4812}'))
    const sent = renderPreview(headWith("application/json"))
    const view = await screen.findByTestId("code-view")
    expect(view.getAttribute("data-language")).toBe("json")
    expect(view.textContent).toBe('{\n  "total": 4812\n}')
    expect(sent[0]).toEqual({ intent: "objects.contentUrl", params: { bucket: "reports", key: HEAD.object.key, purpose: "preview" } })
  })

  it("says when it shows only the first 256 KiB, and does not reformat a cut JSON", async () => {
    vi.stubGlobal("fetch", respond("x".repeat(PREVIEW_LIMIT)))
    renderPreview(headWith("application/json", 900_000))
    expect(await screen.findByText("Showing the first 256 KiB.")).toBeTruthy()
    expect((await screen.findByTestId("code-view")).textContent?.length).toBe(PREVIEW_LIMIT)
  })

  it("shows an image from a Blob behind an object URL", async () => {
    vi.stubGlobal("fetch", respond(new Uint8Array([137, 80, 78, 71])))
    const sent = renderPreview(headWith("image/png", 20480))
    const img = (await screen.findByRole("img", { name: `Preview of ${HEAD.object.key}` })) as HTMLImageElement
    expect(img.getAttribute("src")).toBe("blob:preview")
    expect(sent[0].params).toEqual({ bucket: "reports", key: HEAD.object.key, purpose: "download" })
  })

  it("does not fetch an image over 4 MiB", async () => {
    const fetchSpy = respond("")
    vi.stubGlobal("fetch", fetchSpy)
    const sent = renderPreview(headWith("image/jpeg", 5 * 1024 * 1024))
    expect(await screen.findByText(/over 4 MiB as stored/)).toBeTruthy()
    expect(sent).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("says there is no preview for other types, and asks for nothing", () => {
    const sent = renderPreview(headWith("application/pdf"))
    expect(screen.getByText("No preview for this content type.")).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("shows the content route's own refusal", async () => {
    vi.stubGlobal("fetch", respond(JSON.stringify({ error: "This ticket has expired. Ask for a new link." }), { status: 403 }))
    renderPreview(headWith("text/plain"))
    expect(await screen.findByText("This ticket has expired. Ask for a new link.")).toBeTruthy()
  })

  it("says so when the route never answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")))
    renderPreview(headWith("text/plain"))
    expect(await screen.findByText("The content route did not answer.")).toBeTruthy()
  })

  it("lets go of the object URL when it unmounts", async () => {
    vi.stubGlobal("fetch", respond(new Uint8Array([1])))
    const recorded = recordingQueryClient({ "objects.contentUrl": LINK })
    const { unmount } = render(
      <PluginProvider client={recorded.client}>
        <Preview store="" bucket="reports" head={headWith("image/png")} />
      </PluginProvider>,
    )
    await screen.findByRole("img")
    unmount()
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview"))
  })
})
```

Add to `test/lazy-chunks.test.ts`, replacing the "names CodeMirror in no file yet" test:

```ts
  it("names CodeMirror only in the code view", () => {
    expect(namingFiles("@codemirror")).toEqual(["../src/components/code-view.tsx"])
  })

  it("reaches the code view from the preview through lazy(), and from nowhere else", () => {
    const preview = sourceOf(modules["../src/components/preview.tsx"])
    expect(preview).toMatch(/lazy\(\(\)\s*=>\s*import\("\.\/code-view"\)\)/)
    const staticImporters = Object.entries(modules)
      .filter(([, mod]) => /^import (?!type)[^\n]*code-view["']/m.test(sourceOf(mod)))
      .map(([path]) => path)
    expect(staticImporters).toEqual([])
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/preview.test.tsx test/lazy-chunks.test.ts`
Expected: FAIL, modules and exports not found.

- [ ] **Step 3: Extend `src/content.ts`**

Append:

```ts
/** The most a preview ticket returns. The route stops there. */
export const PREVIEW_LIMIT = 256 * 1024
/** Images larger than this as stored are not fetched for a preview. */
export const IMAGE_PREVIEW_MAX = 4 * 1024 * 1024

const TEXT_TYPES = new Set([
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-ndjson",
  "application/sql",
])

export type PreviewKind = "json" | "text" | "image" | "none"

/** What the inspector can show for a content type. */
export function previewKind(contentType: string | null): PreviewKind {
  if (!contentType) return "none"
  const type = contentType.split(";")[0].trim().toLowerCase()
  if (type === "application/json" || type.endsWith("+json")) return "json"
  if (type.startsWith("text/") || TEXT_TYPES.has(type) || type.endsWith("+xml")) return "text"
  if (type.startsWith("image/")) return "image"
  return "none"
}

/**
 * Fetches bytes from the content route. The route answers JSON
 * `{"error": "..."}` on refusal, which becomes the message. A body that
 * breaks off after the status line arrives as a rejected read, which is a
 * failure, never a short file.
 */
export async function fetchContent(url: string): Promise<ArrayBuffer> {
  let res: Response
  try {
    res = await fetch(url, { credentials: "same-origin", cache: "no-store" })
  } catch {
    throw new ContentRouteError(0, "The content route did not answer.")
  }
  if (!res.ok) {
    let message = `The content route answered ${res.status}.`
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === "string" && body.error !== "") message = body.error
    } catch {
      // Not JSON: keep the status line.
    }
    throw new ContentRouteError(res.status, message)
  }
  try {
    return await res.arrayBuffer()
  } catch {
    throw new ContentRouteError(res.status, "The download broke off before it finished.")
  }
}
```

- [ ] **Step 4: Implement `src/components/code-view.tsx`**

```tsx
import { useEffect, useRef } from "react"
import { EditorState } from "@codemirror/state"
import { EditorView, keymap, lineNumbers } from "@codemirror/view"
import { json } from "@codemirror/lang-json"
import { codeFolding, defaultHighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from "@codemirror/language"
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search"
import { defaultKeymap } from "@codemirror/commands"

// The kit's tokens, so the view follows light and dark with the shell.
const theme = EditorView.theme({
  "&": { fontSize: "12px", backgroundColor: "transparent", color: "var(--foreground)" },
  ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)", lineHeight: "1.55" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "transparent" },
  "&.cm-focused": { outline: "2px solid var(--ring)", outlineOffset: "2px" },
  ".cm-panels": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
})

/**
 * Read-only CodeMirror: line numbers, folding and search, nothing editable.
 * The only file in this package that names CodeMirror, and loaded through
 * lazy() by the preview, so it never reaches the shell's entry chunk.
 */
export default function CodeView({ text, language, label }: { text: string; language: "json" | "text"; label: string }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!host.current) return
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          codeFolding(),
          foldGutter(),
          syntaxHighlighting(defaultHighlightStyle),
          ...(language === "json" ? [json()] : []),
          search({ top: true }),
          highlightSelectionMatches(),
          keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
          EditorState.readOnly.of(true),
          EditorView.contentAttributes.of({ "aria-label": label }),
          theme,
        ],
      }),
    })
    return () => view.destroy()
  }, [text, language, label])
  return <div ref={host} className="max-h-96 overflow-auto rounded-md border" />
}
```

- [ ] **Step 5: Implement `src/components/preview.tsx`**

```tsx
import { Suspense, lazy, useEffect, useState } from "react"
import { usePluginClient } from "@forge-go/dashboard-plugin"
import { Spinner } from "@forge-go/dashboard-kit/components/spinner"
import { ContentRouteError, IMAGE_PREVIEW_MAX, PREVIEW_LIMIT, fetchContent, previewKind } from "../content"
import { withStore } from "../store"
import type { ContentLink, ObjectHead } from "../types"

const CodeView = lazy(() => import("./code-view"))

type State =
  | { status: "loading" }
  | { status: "text"; text: string; cut: boolean }
  | { status: "image"; url: string }
  | { status: "error"; message: string }

function messageOf(error: unknown): string {
  if (error instanceof ContentRouteError) return error.message
  if (error instanceof Error && error.message !== "") return error.message
  return "The preview could not be loaded."
}

/**
 * A look at the object's bytes. Text through a preview ticket, capped at
 * 256 KiB by the route, rendered by CodeMirror. Images through a download
 * ticket into a Blob, shown by object URL in an <img>, where an SVG's script
 * cannot run. Nothing is ever shown inline from the content route. The parent
 * keys this by ETag, so a replaced object is fetched again.
 */
export function Preview({ store, bucket, head }: { store: string; bucket: string; head: ObjectHead }) {
  const kind = previewKind(head.object.contentType)
  const tooBig = kind === "image" && head.object.storedSize > IMAGE_PREVIEW_MAX
  const fetches = kind !== "none" && !tooBig
  const client = usePluginClient()
  const [state, setState] = useState<State>({ status: "loading" })
  const key = head.object.key

  useEffect(() => {
    if (!fetches) return
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const purpose = kind === "image" ? "download" : "preview"
        const link = await client.query<ContentLink>("objects.contentUrl", withStore(store, { bucket, key, purpose }))
        const bytes = await fetchContent(link.url)
        if (cancelled) return
        if (kind === "image") {
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: head.object.contentType ?? "application/octet-stream" }))
          setState({ status: "image", url: objectUrl })
          return
        }
        const cut = bytes.byteLength >= PREVIEW_LIMIT
        let text = new TextDecoder("utf-8").decode(bytes)
        if (kind === "json" && !cut) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2)
          } catch {
            // Not valid JSON: show it as it came.
          }
        }
        setState({ status: "text", text, cut })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: messageOf(error) })
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl)
    }
  }, [fetches, kind, client, store, bucket, key, head.object.contentType])

  let body
  if (kind === "none") {
    body = (
      <p className="text-sm text-muted-foreground">
        {head.object.contentType === null ? "No preview: the driver reports no content type." : "No preview for this content type."}
      </p>
    )
  } else if (tooBig) {
    body = <p className="text-sm text-muted-foreground">This image is over 4 MiB as stored. Download it to see it.</p>
  } else if (state.status === "loading") {
    body = <Spinner />
  } else if (state.status === "error") {
    body = <p className="text-sm text-destructive">{state.message}</p>
  } else if (state.status === "image") {
    body = <img src={state.url} alt={`Preview of ${key}`} className="max-h-96 max-w-full rounded-md border" />
  } else {
    body = (
      <div className="flex flex-col gap-1">
        {state.cut ? <p className="text-xs text-muted-foreground">Showing the first 256 KiB.</p> : null}
        <Suspense fallback={<pre className="max-h-96 overflow-auto rounded-md border p-3 font-mono text-xs">{state.text}</pre>}>
          <CodeView text={state.text} language={kind === "json" ? "json" : "text"} label={`Preview of ${key}`} />
        </Suspense>
      </div>
    )
  }

  return (
    <section aria-label="Preview" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Preview</h3>
      {body}
    </section>
  )
}
```

Check `packages/kit/src/components/spinner.tsx` exports `Spinner`; if not, use the loading text "Loading the preview…". Run the class check on `max-h-96`, `max-w-full`.

- [ ] **Step 6: Show the preview in the inspector**

In `src/pages/browser.tsx`, extend the inspector's render slot:

```tsx
                {(head) => (
                  <>
                    <ObjectActions store={store} bucket={bucket} prefix={prefix} head={head} casBucket={casBucket} />
                    <Preview key={`${head.object.key}\n${head.object.etag ?? ""}\n${head.object.lastModified ?? ""}`} store={store} bucket={bucket} head={head} />
                  </>
                )}
```

with `import { Preview } from "../components/preview"`.

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass.

- [ ] **Step 8: Commit**

`git add` the new files, then `git commit --only -m "feat(plugin-trove): preview text and images without serving them inline" -m "<a 2 to 5 line body, per Global Constraints>" -- <every file you changed>`, then `git show --stat HEAD`.

---

### Task 7: Uploads

**Files:**
- Create: `src/uploads.ts`, `src/components/upload-tray.tsx`
- Modify: `src/pages/browser.tsx`, `test/harness.tsx`
- Test: `test/uploads.test.tsx`

**Interfaces:**
- Consumes: `UploadTicket`, `ObjectRow`, `SystemStatus` (`config.maxUploadBytes`), `withStore`, `humanBytes`, `folderOf`.
- Produces: `type UploadState = "waiting" | "starting" | "uploading" | "completing" | "done" | "conflict" | "failed" | "cancelled"`; `interface Upload { id; store; bucket; key; size; state; loaded; message? }`; `useUploads(): Upload[]`; `enqueueUploads(client, dest: { store; bucket; folder; maxBytes: number | null }, files: File[]): void`; `cancelUpload(id)`; `replaceUpload(id)`; `dismissUpload(id)`; `clearFinishedUploads()`; `resetUploads()`; `UploadDropZone({ store, bucket, folder, maxBytes, disabled, children })`; `UploadTray()`; `UploadButton({ store, bucket, folder, maxBytes, disabled })`.

- [ ] **Step 1: Reset the queue between tests**

In `test/harness.tsx`'s `beforeEach`, add `resetUploads()` (import from `../src/uploads`).

- [ ] **Step 2: Write the failing tests**

`test/uploads.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContractError, PluginProvider } from "@forge-go/dashboard-plugin"
import type { ScopedClient } from "@forge-go/dashboard-plugin"
import { UploadDropZone, UploadTray } from "../src/components/upload-tray"
import { enqueueUploads } from "../src/uploads"
import "./harness"

class FakeXHR {
  static instances: FakeXHR[] = []
  method = ""
  url = ""
  headers: Record<string, string> = {}
  body: unknown = null
  status = 0
  responseText = ""
  upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  aborted = false
  constructor() {
    FakeXHR.instances.push(this)
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: unknown) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true })
  }
  finish(status: number, body: unknown) {
    this.status = status
    this.responseText = typeof body === "string" ? body : JSON.stringify(body)
    this.onload?.()
  }
}

const TICKET = { url: "/dashboard/trove/content", ticket: "tk1", expiresAt: "2026-09-30T12:15:00Z" }
const ROW = { key: "2026/q3.csv", storedSize: 10, etag: "e", lastModified: null, contentType: "text/csv", storageClass: null }

function client(commands: (intent: string, payload: Record<string, unknown>, n: number) => unknown) {
  const sent: { intent: string; payload: Record<string, unknown> }[] = []
  const c = {
    extension: "trove",
    query: async () => {
      throw new ContractError("NOT_FOUND", "no queries here")
    },
    command: async (intent: string, payload: Record<string, unknown>) => {
      sent.push({ intent, payload })
      const answer = commands(intent, payload, sent.filter((s) => s.intent === intent).length)
      if (answer instanceof Error) throw answer
      return answer
    },
  } as unknown as ScopedClient
  return { client: c, sent }
}

function file(name: string, size = 10, type = "text/csv") {
  return new File(["x".repeat(size)], name, { type })
}

function renderTray(c: ScopedClient) {
  return render(
    <PluginProvider client={c}>
      <UploadTray />
    </PluginProvider>,
  )
}

beforeEach(() => {
  FakeXHR.instances = []
  vi.stubGlobal("XMLHttpRequest", FakeXHR)
})
afterEach(() => vi.unstubAllGlobals())

describe("uploads", () => {
  it("begins, PUTs with the ticket in the header, reports progress, then completes", async () => {
    const { client: c, sent } = client((intent) => (intent === "objects.beginUpload" ? TICKET : ROW))
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "2026/", maxBytes: null }, [file("q3.csv")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    expect(sent[0]).toEqual({ intent: "objects.beginUpload", payload: { bucket: "reports", key: "2026/q3.csv", size: 10, contentType: "text/csv", overwrite: false } })
    const xhr = FakeXHR.instances[0]
    expect(xhr.method).toBe("PUT")
    expect(xhr.url).toBe("/dashboard/trove/content")
    expect(xhr.headers["X-Trove-Ticket"]).toBe("tk1")
    expect(xhr.url).not.toContain("?")
    act(() => xhr.progress(5, 10))
    expect((await screen.findByRole("progressbar", { name: "Uploading 2026/q3.csv" })).getAttribute("aria-valuenow")).toBe("50")
    act(() => xhr.finish(200, { key: "2026/q3.csv", storedSize: 10, etag: "e" }))
    await waitFor(() => expect(sent[1]).toEqual({ intent: "objects.completeUpload", payload: { bucket: "reports", key: "2026/q3.csv" } }))
    expect(await screen.findByText("Uploaded")).toBeTruthy()
  })

  it("leaves contentType out when the browser did not fill it in", async () => {
    const { client: c, sent } = client(() => TICKET)
    act(() => enqueueUploads(c, { store: "archive", bucket: "b", folder: "", maxBytes: null }, [file("x.bin", 3, "")]))
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].payload).toEqual({ store: "archive", bucket: "b", key: "x.bin", size: 3, overwrite: false })
  })

  it("refuses a file over the limit before asking the server", async () => {
    const { client: c, sent } = client(() => TICKET)
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: 5 }, [file("big.csv", 10)]))
    expect(await screen.findByText(/larger than the 5 B upload limit/)).toBeTruthy()
    expect(sent).toEqual([])
  })

  it("asks before replacing an existing object, and sends overwrite when told to", async () => {
    const { client: c, sent } = client((intent, _p, n) =>
      intent === "objects.beginUpload" && n === 1 ? new ContractError("CONFLICT", "an object with this key already exists", { exists: true }) : intent === "objects.beginUpload" ? TICKET : ROW,
    )
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("q3.csv")]))
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }))
    await waitFor(() => expect(sent.filter((s) => s.intent === "objects.beginUpload").map((s) => s.payload.overwrite)).toEqual([false, true]))
  })

  it("keeps a scan block on its own row", async () => {
    const { client: c } = client(() => TICKET)
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("eicar.txt")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    act(() => FakeXHR.instances[0].finish(422, { error: "A content scan blocked this upload." }))
    expect(await screen.findByText("A content scan blocked this upload.")).toBeTruthy()
  })

  it("cancels an upload in flight", async () => {
    const { client: c, sent } = client(() => TICKET)
    renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("q3.csv")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(FakeXHR.instances[0].aborted).toBe(true)
    expect(await screen.findByText("Cancelled")).toBeTruthy()
    expect(sent.some((s) => s.intent === "objects.completeUpload")).toBe(false)
  })

  it("runs two at a time", async () => {
    const { client: c } = client((intent) => (intent === "objects.beginUpload" ? TICKET : ROW))
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("a"), file("b"), file("c")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(2))
    act(() => FakeXHR.instances[0].finish(200, { key: "a", storedSize: 10, etag: "e" }))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(3))
  })

  it("keeps going, and stays visible, when the tray unmounts and comes back", async () => {
    const { client: c } = client((intent) => (intent === "objects.beginUpload" ? TICKET : ROW))
    const first = renderTray(c)
    act(() => enqueueUploads(c, { store: "", bucket: "reports", folder: "", maxBytes: null }, [file("q3.csv")]))
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1))
    first.unmount()
    act(() => FakeXHR.instances[0].finish(200, { key: "q3.csv", storedSize: 10, etag: "e" }))
    renderTray(c)
    expect(await screen.findByText("Uploaded")).toBeTruthy()
  })

  it("refuses a dropped folder and names the destination while dragging", async () => {
    const { client: c, sent } = client(() => TICKET)
    render(
      <PluginProvider client={c}>
        <UploadDropZone store="" bucket="reports" folder="2026/09/" maxBytes={67108864} disabled={false}>
          <p>listing</p>
        </UploadDropZone>
      </PluginProvider>,
    )
    const zone = screen.getByText("listing").parentElement!
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } })
    expect(screen.getByText("reports/2026/09/").className).toContain("font-mono")
    const folderItem = { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => null }
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], items: [folderItem], files: [] } })
    expect(await screen.findByText(/Folders can't be uploaded here/)).toBeTruthy()
    expect(sent).toEqual([])
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove exec vitest run test/uploads.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `src/uploads.ts`**

```ts
import { useSyncExternalStore } from "react"
import type { ContractError, ScopedClient } from "@forge-go/dashboard-plugin"
import { humanBytes } from "./format"
import { withStore } from "./store"
import type { UploadTicket } from "./types"

export type UploadState = "waiting" | "starting" | "uploading" | "completing" | "done" | "conflict" | "failed" | "cancelled"

export interface Upload {
  id: string
  store: string
  bucket: string
  key: string
  size: number
  state: UploadState
  loaded: number
  message?: string
}

interface Item extends Upload {
  file: File
  client: ScopedClient
  overwrite: boolean
  xhr?: XMLHttpRequest
}

const CONCURRENCY = 2
let items: Item[] = []
let snapshot: Upload[] = []
let counter = 0
const listeners = new Set<() => void>()

function publish() {
  snapshot = items.map(({ id, store, bucket, key, size, state, loaded, message }) => ({ id, store, bucket, key, size, state, loaded, message }))
  for (const listener of listeners) listener()
}

function update(id: string, patch: Partial<Item>) {
  items = items.map((item) => (item.id === id ? { ...item, ...patch } : item))
  publish()
}

function find(id: string): Item | undefined {
  return items.find((item) => item.id === id)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Every upload this tab has started, wherever the operator is now. Module
 * state, so an upload keeps going and stays visible when the operator opens
 * another prefix or leaves the browser and comes back.
 */
export function useUploads(): Upload[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
}

const ACTIVE: UploadState[] = ["starting", "uploading", "completing"]

function pump() {
  let running = items.filter((item) => ACTIVE.includes(item.state)).length
  for (const item of items) {
    if (running >= CONCURRENCY) break
    if (item.state !== "waiting") continue
    running++
    void run(item.id)
  }
}

function putFailure(status: number, body: string): { state: UploadState; message: string } {
  let message = ""
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    if (typeof parsed.error === "string") message = parsed.error
  } catch {
    // Not JSON.
  }
  if (status === 409) return { state: "conflict", message: message || "An object with this key already exists." }
  if (status === 413) return { state: "failed", message: message || "The file is larger than the size the upload was started with." }
  if (status === 422) return { state: "failed", message: message || "A content scan blocked this upload." }
  if (status === 403) return { state: "failed", message: `The upload ticket was refused. ${message}`.trim() }
  return { state: "failed", message: message || `The content route answered ${status}.` }
}

function put(id: string, ticket: UploadTicket, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    update(id, { xhr })
    xhr.open("PUT", ticket.url)
    // Upload tickets go in this header, never in the URL: forge's tracing
    // records the query string.
    xhr.setRequestHeader("X-Trove-Ticket", ticket.ticket)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) update(id, { loaded: event.loaded })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(putFailure(xhr.status, xhr.responseText))
    }
    xhr.onerror = () => reject({ state: "failed", message: "The upload connection failed." })
    xhr.onabort = () => reject({ state: "cancelled", message: undefined })
    xhr.send(file)
  })
}

async function run(id: string) {
  const start = find(id)
  if (!start) return
  const { client, store, bucket, key, file, overwrite } = start
  update(id, { state: "starting", loaded: 0, message: undefined })
  let ticket: UploadTicket
  try {
    ticket = await client.command<UploadTicket>(
      "objects.beginUpload",
      withStore(store, { bucket, key, size: file.size, ...(file.type !== "" ? { contentType: file.type } : {}), overwrite }),
    )
  } catch (error) {
    const e = error as ContractError
    if (find(id)?.state === "cancelled") return
    if (e.code === "CONFLICT" && e.details?.exists === true) update(id, { state: "conflict", message: "An object with this key already exists." })
    else update(id, { state: "failed", message: e.message })
    pump()
    return
  }
  if (find(id)?.state === "cancelled") {
    pump()
    return
  }
  update(id, { state: "uploading" })
  try {
    await put(id, ticket, file)
  } catch (failure) {
    const f = failure as { state: UploadState; message?: string }
    update(id, { state: f.state, message: f.message, xhr: undefined })
    pump()
    return
  }
  update(id, { state: "completing", loaded: file.size, xhr: undefined })
  try {
    // completeUpload is a command, so its invalidates refresh the listing.
    await client.command("objects.completeUpload", withStore(store, { bucket, key }))
    update(id, { state: "done" })
  } catch (error) {
    update(id, { state: "failed", message: `Uploaded, but confirming it failed: ${(error as ContractError).message}. Refresh the listing to check.` })
  }
  pump()
}

/** Queues files for `bucket`, each under `folder` + its name. */
export function enqueueUploads(
  client: ScopedClient,
  dest: { store: string; bucket: string; folder: string; maxBytes: number | null },
  files: File[],
): void {
  for (const file of files) {
    counter += 1
    const tooBig = dest.maxBytes !== null && file.size > dest.maxBytes
    items = [
      ...items,
      {
        id: `up_${counter}`,
        store: dest.store,
        bucket: dest.bucket,
        key: `${dest.folder}${file.name}`,
        size: file.size,
        state: tooBig ? "failed" : "waiting",
        loaded: 0,
        message: tooBig ? `This file is larger than the ${humanBytes(dest.maxBytes ?? 0)} upload limit.` : undefined,
        file,
        client,
        overwrite: false,
      },
    ]
  }
  publish()
  pump()
}

export function cancelUpload(id: string): void {
  const item = find(id)
  if (!item) return
  if (item.state === "waiting" || item.state === "starting") {
    update(id, { state: "cancelled" })
    pump()
    return
  }
  if (item.state === "uploading") item.xhr?.abort()
}

/** Starts a conflicted upload again, this time replacing the existing object. */
export function replaceUpload(id: string): void {
  if (find(id)?.state !== "conflict") return
  update(id, { state: "waiting", overwrite: true, message: undefined })
  pump()
}

export function dismissUpload(id: string): void {
  items = items.filter((item) => item.id !== id)
  publish()
}

export function clearFinishedUploads(): void {
  items = items.filter((item) => !["done", "failed", "cancelled"].includes(item.state))
  publish()
}

/** Tests only: forget everything. */
export function resetUploads(): void {
  for (const item of items) item.xhr?.abort()
  items = []
  counter = 0
  publish()
}
```

If `humanBytes(5)` does not read "5 B", adjust the test's expected text to what `humanBytes` returns for 5, keeping the assertion that the limit is named.

- [ ] **Step 5: Implement `src/components/upload-tray.tsx`**

```tsx
import { useRef, useState } from "react"
import type { DragEvent, ReactNode } from "react"
import { usePluginClient } from "@forge-go/dashboard-plugin"
import { Button } from "@forge-go/dashboard-kit/components/button"
import { Progress } from "@forge-go/dashboard-kit/components/progress"
import { humanBytes } from "../format"
import {
  cancelUpload,
  clearFinishedUploads,
  dismissUpload,
  enqueueUploads,
  replaceUpload,
  useUploads,
} from "../uploads"
import type { Upload } from "../uploads"

interface Destination {
  store: string
  bucket: string
  folder: string
  maxBytes: number | null
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files")
}

/**
 * The listing as a drop target. Native drag and drop: files are queued,
 * folders refused, since a folder entry would need a recursive walk the
 * contract has no batch for.
 */
export function UploadDropZone({ store, bucket, folder, maxBytes, disabled, children }: Destination & { disabled: boolean; children: ReactNode }) {
  const client = usePluginClient()
  const [dragging, setDragging] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  function onDragOver(event: DragEvent) {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    setDragging(true)
  }

  function onDrop(event: DragEvent) {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    setDragging(false)
    const files: File[] = []
    let folders = 0
    for (const item of Array.from(event.dataTransfer.items ?? [])) {
      if (item.kind !== "file") continue
      const entry = item.webkitGetAsEntry?.()
      if (entry?.isDirectory) {
        folders++
        continue
      }
      const f = item.getAsFile()
      if (f) files.push(f)
    }
    setRefusal(folders > 0 ? "Folders can't be uploaded here. Drop the files inside them instead." : null)
    if (files.length > 0) enqueueUploads(client, { store, bucket, folder, maxBytes }, files)
  }

  return (
    <div
      className="relative flex flex-col gap-3"
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {children}
      {refusal ? <p className="text-sm text-destructive">{refusal}</p> : null}
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed bg-background/90 text-sm">
          <span>Drop files to upload to</span>
          <span className="font-mono text-xs">{`${bucket}/${folder}`}</span>
          {maxBytes !== null ? <span className="text-xs text-muted-foreground">{`Up to ${humanBytes(maxBytes)} per file.`}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

export function UploadButton({ store, bucket, folder, maxBytes, disabled }: Destination & { disabled: boolean }) {
  const client = usePluginClient()
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Files to upload"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) enqueueUploads(client, { store, bucket, folder, maxBytes }, files)
          e.target.value = ""
        }}
      />
      <Button size="sm" disabled={disabled} onClick={() => input.current?.click()}>
        Upload files
      </Button>
    </>
  )
}

const STATE_LABEL: Record<Upload["state"], string> = {
  waiting: "Waiting",
  starting: "Starting",
  uploading: "Uploading",
  completing: "Confirming",
  done: "Uploaded",
  conflict: "Already exists",
  failed: "Failed",
  cancelled: "Cancelled",
}

/** Every upload in this tab, each on its own row with its own outcome. */
export function UploadTray() {
  const uploads = useUploads()
  if (uploads.length === 0) return null
  const finished = uploads.some((u) => ["done", "failed", "cancelled"].includes(u.state))
  return (
    <section aria-label="Uploads" className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{`Uploads (${uploads.length})`}</h3>
        {finished ? (
          <Button size="sm" variant="ghost" onClick={clearFinishedUploads}>
            Clear finished
          </Button>
        ) : null}
      </div>
      <ul className="flex flex-col gap-2">
        {uploads.map((u) => {
          const pct = u.size > 0 ? Math.round((u.loaded / u.size) * 100) : 0
          return (
            <li key={u.id} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="block max-w-sm truncate font-mono text-xs" title={`${u.bucket}/${u.key}`}>
                  {`${u.bucket}/${u.key}`}
                </span>
                <span className="text-xs text-muted-foreground">{STATE_LABEL[u.state]}</span>
              </div>
              {u.state === "uploading" ? <Progress value={pct} aria-label={`Uploading ${u.key}`} /> : null}
              {u.message ? <p className={u.state === "conflict" ? "text-xs" : "text-xs text-destructive"}>{u.message}</p> : null}
              <div className="flex gap-2">
                {["waiting", "starting", "uploading"].includes(u.state) ? (
                  <Button size="sm" variant="ghost" onClick={() => cancelUpload(u.id)}>
                    Cancel
                  </Button>
                ) : null}
                {u.state === "conflict" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => replaceUpload(u.id)}>
                      Replace
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismissUpload(u.id)}>
                      Skip
                    </Button>
                  </>
                ) : null}
                {["done", "failed", "cancelled"].includes(u.state) ? (
                  <Button size="sm" variant="ghost" onClick={() => dismissUpload(u.id)}>
                    Dismiss
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

The progress test reads `aria-valuenow` from `role="progressbar"`; Base UI's Progress root renders that role with the label. If `aria-label` does not reach the element with the role, read `progress.tsx` and pass the label where it lands, keeping the accessible name `Uploading <key>`. Run the class check on `relative`, `absolute`, `inset-0`, `pointer-events-none`, `border-2`, `border-dashed`, `bg-background/90`, `justify-between`; swap any that are missing (for example `bg-background/80`) and say so.

- [ ] **Step 6: Put uploads on the page**

In `src/pages/browser.tsx`:

```tsx
  const status = useQuery<SystemStatus>("system.status", withStore(store, {}))
  const maxBytes = status.data?.config.maxUploadBytes ?? null
  const folder = folderOf(prefix)
  const uploadsRefused = casBucket !== null && casBucket === bucket
```

Pass `<UploadButton store={store} bucket={bucket} folder={folder} maxBytes={maxBytes} disabled={uploadsRefused} />` as `PageHeader`'s `actions`, wrap the listing panel's content in `<UploadDropZone ... disabled={uploadsRefused}>`, and render `<UploadTray />` under the listing inside the drop zone. When `uploadsRefused`, show under the header: `<p className="text-sm text-muted-foreground">CAS manages this bucket. Its objects are written through CAS, not uploaded here.</p>`. Add `"system.status"` to the browser-page tests' stub maps with the Overview tests' status fixture (`config.maxUploadBytes: 67108864`).

- [ ] **Step 7: Run everything**

Run: `pnpm --filter @forge-go/dashboard-plugin-trove test && pnpm --filter @forge-go/dashboard-plugin-trove typecheck && pnpm --filter @forge-go/dashboard-plugin-trove lint`
Expected: all pass.

- [ ] **Step 8: Commit**

`git add` the new files, then `git commit --only -m "feat(plugin-trove): upload files by drop or picker with per-file progress" -m "<a 2 to 5 line body, per Global Constraints>" -- <every file you changed>`, then `git show --stat HEAD`.

---

### Task 8 (controller): Bundle measurement, browser walk, and the notes for slice 5

**Files:**
- Modify: `BASELINE.md`, `docs/superpowers/specs/2026-09-30-trove-dashboard-migration-design.md`

- [ ] **Step 1: Run the workspace tests**

Run: `pnpm -r --no-bail test 2>&1 | tail -40`
Expected: the trove package passes; the only failures are the known pre-existing ones (`packages/host/test/setup-screen.test.tsx`, and `apps/shell/test/app.test.tsx` "sidebar-content not rendered yet"). Anything else gets checked against a build without trove before it is called pre-existing.

- [ ] **Step 2: Measure the shell**

```bash
OUT=$(mktemp -d)
pnpm --filter ./apps/shell exec vite build --outDir "$OUT" 2>&1 | tail -60
ENTRY=$(ls "$OUT"/assets/index-*.js)
for s in EditorView "@codemirror" cm-editor useVirtualizer react-virtual "trove/content" X-Trove-Ticket; do printf '%s %s\n' "$s" "$(grep -o "$s" "$ENTRY" | wc -l)"; done
grep -o 'from"\./[^"]*"' "$ENTRY" | sort -u
grep -l useVirtualizer "$OUT"/assets/*.js; grep -l EditorView "$OUT"/assets/*.js
```

Expected: zero matches in the entry for every string; the browser chunk holds the virtualiser and the upload code; `code-view` is its own small chunk importing the shared CodeMirror `dist-*` chunks. Write a section "Trove's object browser, and where it lands (YYYY-MM-DD)" in `BASELINE.md` in the style of the warden section: method, the eager set, the trove chunks with raw and gzip, where CodeMirror and the virtualiser live, the entry string counts. Commit with `git commit --only -- BASELINE.md` if nobody else has it modified, otherwise with the helper and needle `Trove`.

- [ ] **Step 3: Walk it in the browser**

Start the `fixture-server` and `dashboard-shell` launch configs. At a 1024 px viewport, with screenshots:

- Buckets: bucket names are links; `reports` opens the browser.
- Root of `reports`: folders `2026/`, objects `q3 résumé #1.pdf`, `readme.txt`; caption counts both; the path bar shows `reports /`.
- Folder `2026/` then `09/`; path bar segments link back up; browser Back returns to `2026/` and the listing follows.
- Type `sum` in the path bar input and Enter: only `summary.json` remains, and the URL carries `prefix=2026%2F09%2Fsum`.
- Select `summary.json`: inspector shows fields, `compress` under Applies now, a JSON preview in CodeMirror; Download saves the file with the right name.
- `assets/diagram.svg` previews as an image and no alert appears; `assets/logo.png` previews.
- `q3 résumé #1.pdf`: "No preview for this content type."; Download names the file correctly.
- Copy `readme.txt` to `assets` as `readme-copy.txt`; then again to the same key shows Replace; the success link opens it.
- Delete `readme-copy.txt` from `assets`; the browser returns to the prefix and the row is gone.
- Upload two files by drop into `reports/2026/`: tray shows progress, both land in the listing without a manual refresh. Drop a file named `eicar.txt`: its row says the scan blocked it. Upload `readme.txt` again at the root: Replace works. Drop a folder: refused.
- Open `cas` bucket: Delete says CAS refuses and is disabled; Upload is disabled with the CAS line.
- Switch to `archive` on Buckets, open `backups`: URL carries `store=archive`, the routed note shows, `db/2026-09-30.dump` offers Share link and creates one.
- Reset the fixtures afterwards: `curl -s -X POST http://localhost:8099/dashboard/api/dashboard/v1/_fixture/reset`.

Note anything unstyled (a class the shell does not generate) and fix it in a follow-up commit before moving on.

- [ ] **Step 4: Write what slice 4 found**

Append "## What slice 4 found that slice 5 must know" to the spec: the absolute-link ruling and why, the image download-ticket ruling, the Next proxy gap (content routes need the Vite shell or the Go server), the fixture's unsigned tickets and the `eicar` stand-in, the chunk numbers, anything the walk turned up. Write it with `rex-voice`, no em dashes. Commit with `git commit --only`.
