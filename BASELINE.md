# Bundle baseline

Measured on the initial scaffold, React 19.2 with Base UI, Vite 8.

| composition | raw | gzip |
|---|---|---|
| React + one button | 231 KB | 73 KB |
| chrome only (sidebar, header, stat cards) | 405 KB | 128 KB |
| chart only | 682 KB | 213 KB |
| data table only | 1,008 KB | 305 KB |
| full dashboard-01 | 1,065 KB | 322 KB |

`data-table.tsx` imports recharts for its row-detail drawer, on top of
TanStack Table, four @dnd-kit packages, sonner and zod. That is why the table
alone costs nearly as much as the whole block, and why the data grid and the
chart must be route-level lazy rather than part of the eager entry chunk.

## After splitting (Task 5)

Measured from `apps/playground/dist/assets` after wiring `organism.data-grid`
and `organism.chart` behind `lazy()` in `apps/playground/src/intents.tsx`,
rendered through the graph renderer instead of imported statically from
`App.tsx`.

Six JS chunks are emitted, where before there was one:

| chunk | raw | gzip | loaded |
|---|---|---|---|
| entry chunk | 293.51 KB | 89.15 KB | eager, static from `index.html` |
| rolldown-runtime chunk | 0.71 KB | 0.42 KB | eager, statically imported by the entry |
| Base UI hook chunk (`useRegisterFieldControl`) | 138.93 KB | 48.29 KB | eager, statically imported by the entry |
| chart chunk (`chart-area-interactive`) | 11.92 KB | 3.73 KB | lazy, `organism.chart` |
| data-table chunk | 274.28 KB | 79.46 KB | lazy, `organism.data-grid` |
| Base UI internals chunk (`CompositeRoot`) | 357.04 KB | 108.67 KB | lazy, pulled in only when a lazy chunk that needs it loads |

The eager set is determined by the transitive closure of **static** imports
from the entry chunk, not by what `index.html` happens to `modulepreload` (a
modulepreload link is an optimization hint, not a definition of eagerness,
and only coincides with the real eager set here). Grepping the built entry
chunk confirms it: the rolldown-runtime and Base UI hook chunks appear as
`from"./<chunk>.js"` static imports, while the Base UI internals chunk
(`CompositeRoot`, the single largest chunk at 357.04 KB) appears in the entry
only inside the `__vite__mapDeps` table, the dependency list consumed by the
two `await import()` calls for the chart and the data table. There is no
`from"./CompositeRoot-*.js"` anywhere in the entry chunk, which is why it
stays lazy despite being bigger than every other chunk on its own.

| composition | raw | gzip |
|---|---|---|
| eager entry (entry + rolldown-runtime + Base UI hook chunk) | 433.15 KB | 137.86 KB |

That eager total is well under the 1,065 KB / 322 KB gzip single-chunk
baseline above.

### What the split did and did not do

The eager entry is what the budget governs, and it dropped from 322 KB gzip
to ~137.86 KB. Total bytes did not drop. The default graph in `App.tsx`
renders both heavy blocks on the first screen, so both lazy chunks fetch
immediately and the first view now costs about 1,076.39 KB raw / 329.73 KB
gzip across all six chunks, marginally more than the single 1,065 KB / 322 KB
chunk, because compression is worse across chunk boundaries and Vite does not
modulepreload dynamic-import dependencies, so the two heavy chunks arrive as
a second-stage waterfall rather than in parallel with the entry. What was
bought is time to first paint and a bounded eager budget: the sidebar, header
and stat cards paint without waiting on recharts, TanStack Table or four
@dnd-kit packages. A route that does not render `organism.chart` or
`organism.data-grid` pays nothing for them at all.

### Re-measured after the W1 review fixes

The eager entry moved from 432.07 KB / 137.56 KB gzip to 433.15 KB /
137.86 KB gzip, up 1.08 KB raw and 0.30 KB gzip. That is the intent error
boundary, the `useSyncExternalStore` subscription in `useRegistry`, and the
listener set on the registry. The split itself is unchanged: the entry chunk
still statically imports only the rolldown-runtime and Base UI hook chunks,
and `CompositeRoot` still appears in the entry only inside `__vite__mapDeps`.

## After the plugin platform (Task 12)

The comparison above no longer applies as a like-for-like: the intent
registry and graph renderer that produced the eager/lazy split were deleted
(`refactor(runtime): delete the intent registry and graph renderer`), and
`apps/playground/src/App.tsx` now mounts a single `coreDemoPlugin` through
`PluginHost` instead of the `dashboard-01` block composition that pulled in
recharts, TanStack Table and @dnd-kit. Both changes predate this plan's own
base commit (`22cf81b`), so they are not this plan's doing, and `pnpm build`
now emits one JS chunk for `apps/playground` rather than six — there is
nothing left to split, so that single chunk is the entire eager bundle:

| composition | raw | gzip |
|---|---|---|
| single eager chunk, current | 484.90 KB | 158.36 KB |
| single eager chunk, at this plan's base commit (`22cf81b`) | 445.81 KB | 143.78 KB |

The 39.09 KB raw / 14.58 KB gzip difference is everything landed on the
shared branch since `22cf81b` that touches the bundle, not this plan alone:
the query store, the slot machinery and the context switchers are in there
(all eager, all in scope for this plan), but so is anything the concurrent
authentication workstream added to `PluginHost.tsx` in the same window.
Isolating this plan's own share exactly would need a per-commit bisect,
which this verification pass didn't attempt. The CSS bundle grew far more
sharply in the same window (107.67 KB to 246.98 KB) from the sibling kit
plan's large batch of new UI primitives feeding Tailwind's source scan; that
is the kit plan's footprint, not this one, and outside the JS figures above.

## The whole dashboard (2026-09-22)

Every number above is `apps/playground`, which mounts one demo plugin. That
was the right thing to measure while the playground was the only app, and it
stopped being the right thing once `apps/shell` existed: the shell is what
the Go handler serves, and it compiles in core, streaming and authsome plus
the twenty-four authsome sub-plugins.

| app | raw | gzip |
|---|---|---|
| `apps/playground` js (one demo plugin) | 474.20 KB | 153.16 KB |
| `apps/shell` js (three plugins, twenty-four sub-plugins) | 632.69 KB | 187.64 KB |
| `apps/shell` css | 241.15 KB | 35.61 KB |

Two things worth knowing about those figures.

Wiring `subPlugins` into the shell moved the JS by 0.07 KB, from 632.62 to
632.69. The twenty-four sub-plugins were already in the bundle before
anything mounted them, because `src/index.tsx` imports `./sub` to re-export
`authsomeSubPlugins`. They were costing their full size and rendering nothing.

One chunk, no splitting. Vite says so on every build, and nothing here is
lazy: `ConfirmDialog` and `SettingsForm` pull Base UI into the entry, and
every plugin page is a static import. Route-level `lazy()` on the detail
pages is the obvious next move and it is not this work's to make.

## Relay, and the first lazy chunk in the shell

Measured with `vite build` in `apps/shell` on 2026-09-29, with core,
streaming, authsome, warden, vault and relay registered. The shell's own
`build` script stops at `tsc -b` on type errors in `packages/host` that are
not relay's, so these numbers come from the Vite step alone.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| entry, without relay | 697.08 KB | 206.48 KB | eager |
| entry, with relay | 748.02 KB | 218.17 KB | eager |
| `json-editor` (CodeMirror, JSON, folding, search) | 336.80 KB | 108.90 KB | lazy |

Relay's fifteen pages cost 50.94 KB raw and 11.69 KB gzip in the entry. The
read-only JSON viewer is the shell's first real split: `JsonView` renders
the text as a `<pre>` at once and swaps in CodeMirror from a `lazy()` import
when the chunk arrives, so a page that shows no structured data never loads
it. The entry names the chunk only in its `__vite__mapDeps` table; there is
no static `from"./json-editor-*.js"` import in it, which was checked, because
one stray static import anywhere would pull the whole editor back into the
entry.

## Vault's config editor, and where CodeMirror lands (2026-09-29)

Measured with `vite build` in `apps/shell`, written to a scratch directory so
the shared `dist` stayed as it was. There are two builds. One is the tree as
it stands. The other is a scratch copy of the same tree with the vault
plugin's four config routes (the list, create, entry page and the overrides
page) and their imports taken out, which is what "without" means below. The
nav entries stayed in the copy, since they cost next to nothing. Sizes are
Vite's own kB.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| entry, without the vault config routes | 1,046.64 KB | 297.36 KB | eager |
| entry, with them | 1,056.39 KB | 299.50 KB | eager |
| `config-detail` (the entry page) | 20.67 KB | 6.13 KB | lazy, when you open an entry |
| `json-editor` (vault's editor) | 1.72 KB | 0.91 KB | lazy, for a json entry's value |
| `json-diff` | 20.38 KB | 7.68 KB | lazy, when you compare a json entry's versions |
| CodeMirror, shared (two `dist-*` chunks) | 338.08 KB | 110.11 KB | lazy, with either of the above |

The config routes cost 9.75 KB raw and 2.14 KB gzip in the entry: the list,
create and overrides pages and what only they use. The entry page is not in
that number. It is its own chunk, reached from the
plugin through `lazy()`, and the json editor and the diff are two more
`lazy()` imports inside it, so a text, number, bool or duration entry never
loads either.

CodeMirror is not in the entry. The built entry chunk was searched for
`cm-editor`, `@codemirror`, `EditorView`, `cm-content`, `cm-scroller`,
`cm-gutter`, `cm-line`, `cm-mergeView`, `codemirror` and `lezer`: no matches,
in either build. It has no static `from"./..."` import either, so nothing
pulls a chunk in ahead of the route. The only editor chunk the entry names is
relay's read-only `json-editor`, in its `__vite__mapDeps` table.

With vault's editor and diff in the build, CodeMirror is no longer a single
chunk. Before, relay's viewer carried it alone as one 336.80 KB chunk (the
"without" build still does). Now the viewer, vault's editor and the diff share
two chunks of 294.97 KB and 43.11 KB, which together are 1.28 KB larger than
the old single one, and each caller is a thin wrapper of a kilobyte or two.
Opening a json entry pulls `config-detail`, `json-editor` and those two:
about 360 KB raw, 117 KB gzip, on first open only.

The entry is 1,056 KB here, against 748 KB in the relay section above. The
difference is not vault's: this tree carries other workstreams' uncommitted
work, and the "without" build (1,046.64 KB) already has it. Read the 9.75 KB
as this task's share and the rest as theirs.

## Chronicle, and recharts off the entry (2026-09-30)

Measured with `vite build` in `apps/shell`, written to a scratch directory so
the shared `dist` stayed as it was. The shell's own `build` script stops at
`tsc -b` on type errors in `src/design-preview`, which is another session's
untracked work, so these numbers come from the Vite step alone. The plugin's
source compiled clean under the shell's flags in that same `tsc -b` run. As
before there are two builds: the tree as it stands, and the same tree with
`chroniclePlugin` taken out of `App.tsx`. Sizes are Vite's own kB.

The entry now statically imports a handful of small shared chunks, so the
eager figure below is the entry plus everything it imports with `from"./..."`.
Comparing the entry chunk alone would mislead, because code shifts between
those chunks from one build to the next.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| eager, without chronicle | 1,213.32 KB | 342.01 KB | eager |
| eager, with chronicle | 1,286.26 KB | 362.12 KB | eager |
| `event-detail` | 5.37 KB | 2.02 KB | lazy, when you open an event |
| `json-editor` (chronicle's viewer) | 1.17 KB | 0.65 KB | lazy, inside the event page |
| `activity` | 5.74 KB | 2.37 KB | lazy, when you open Activity |
| `chart` (recharts, shared with ledger's usage page) | 339.87 KB | 101.11 KB | lazy, with either page |
| CodeMirror, shared (two `dist-*` chunks) | 338.08 KB | 110.11 KB | lazy, as before |

Chronicle's eighteen pages cost 72.94 KB raw and 20.11 KB gzip in the eager
set.

The first build with chronicle mounted was a lot worse: the eager set was
1,631.83 KB raw and 463.96 KB gzip, 419 KB and 123 KB gzip above the build
without it. The Activity page imported the kit's chart statically, and the
chart is recharts, so every operator paid for it whether or not they ever
opened Activity. The entry held 84 `recharts` strings and the build without
chronicle held none. Activity is a `lazy()` route now, and a test in the
plugin fails if anything else there imports the chart.

CodeMirror is not in the eager set. Every eager chunk was searched for
`cm-editor`, `@codemirror`, `EditorView`, `cm-content`, `cm-scroller`,
`cm-gutter`, `cm-line`, `codemirror`, `lezer` and `recharts`, with no matches.
`grep -l codemirror` over the built assets lists one file, the shared
`dist-*` chunk, and `grep -l recharts` lists only the `chart` chunk. The entry
names `event-detail` and `activity` only in its `__vite__mapDeps` table.

The CSS is 273.54 KB (40.93 KB gzip) in both builds, because chronicle's
Tailwind `@source` line lives in `apps/shell/src/styles.css`, which is
untracked and was present for both.
