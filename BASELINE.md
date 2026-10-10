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
1,631.83 KB raw and 463.96 KB gzip, 418.51 KB raw and 121.95 KB gzip above
the build without it. The Activity page imported the kit's chart statically,
and the chart is recharts, so every operator paid for it whether or not they
ever opened Activity. The entry held 84 `recharts` strings and the build without
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

## Ledger, and three more lazy chunks (2026-09-30)

Measured with `vite build` in `apps/shell` on 2026-09-30, written to a scratch
directory so the shared `dist` stayed as it was. Eight plugins are registered
in the shell: core, streaming, authsome, warden, vault, chronicle, relay and
ledger. There are two builds, the tree as it stands and the same tree with
ledger taken out of `App.tsx`. Removing only the array entry changes nothing,
because the import alone keeps the plugin in the build, so the import went too.
Sizes are Vite's own kB, and the eager figure is the entry plus everything it
imports with `from"./..."`, for the reason given in the chronicle section.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| eager, without ledger | 1,218.67 KB | 344.61 KB | eager |
| eager, with ledger | 1,303.76 KB | 366.51 KB | eager |
| `plan-detail` | 6.25 KB | 2.32 KB | lazy, when you open a plan |
| `invoice-detail` | 9.37 KB | 3.40 KB | lazy, when you open an invoice |
| `ledger-table` (react-table, shared by the two above) | 30.50 KB | 9.59 KB | lazy, with either |
| `usage` | 9.72 KB | 3.64 KB | lazy, when you open Usage |
| `chart` (recharts, shared with chronicle's Activity) | 339.87 KB | 101.11 KB | lazy, with either page |

Ledger's eighteen eager routes cost 85.09 KB raw and 21.90 KB gzip. The entry
chunk itself grew by 20.11 KB raw and shrank by 0.83 KB gzip, which looks like
a bargain until you notice that four shared chunks joined the eager set beside
it: `confirm-dialog` (55.73 KB), `empty-state` (5.45 KB), `label` (4.85 KB) and
`none-cell` (0.25 KB), 66.28 KB raw and 23.33 KB gzip between them. Vite names
a shared chunk after its first module, so the names say less than they seem to.
Read the eager row, not the entry.

The three lazy routes really are lazy. For each of `usage`, `plan-detail` and
`invoice-detail`, a search of the built entry for `from"./<chunk>-..."` found
no static import. Each name turns up twice: once in `__vite__mapDeps`, and once
in the `lazy()` call that imports it. Opening a plan loads `plan-detail` and
`ledger-table`, 36.75 KB raw and 11.91 KB gzip. An invoice loads
`invoice-detail` and `ledger-table`, 39.87 KB and 12.99 KB. Usage loads `usage`
and `chart`, 349.59 KB and 104.75 KB, and that is where the weight is.

Recharts is not in the entry. `recharts-bar-rectangle` and
`recharts-cartesian-grid` each have zero matches in it, and so does the bare
word `recharts`. Over every built asset, `grep -l recharts` lists one file,
`chart-*.js`. The entry has no match for `tanstack` or `react-table` either.

The chart chunk is new in the with-ledger build. Without ledger, recharts lives
inside chronicle's `activity` chunk (345.42 KB raw, 103.06 KB gzip). With
ledger, two lazy pages want it, so Vite pulls it out, and `activity` drops to
5.74 KB. Opening Activity now loads 345.61 KB raw and 103.48 KB gzip across the
two files, which is within half a kilobyte of before.

The CSS is 273.83 KB (40.96 KB gzip) in both builds. Ledger's Tailwind
`@source` line lives in `apps/shell/src/styles.css`, which is untracked and was
present for both. As in the sections above, this tree carries other
workstreams' uncommitted work in both builds, so the 85.09 KB is ledger's share
and the rest of the eager total is not.

## Warden's schema editor and graphs, and where they land (2026-10-02)

Measured with `vite build` in `apps/shell` on 2026-10-02, written to a scratch
directory with `--outDir` so the shared `dist` stayed as it was. The shell's
own `build` script is `tsc -b && vite build`, and `tsc -b` was skipped: it can
stop on another session's untracked files, and this measurement is about what
Vite emits. Sizes are Vite's own kB (1 kB is 1,000 bytes, gzip as Vite
reports it). A plain `gzip -c <file> | wc -c` comes out about 1% smaller, which
is a difference in the compressor and not in the files.

Eleven plugins are registered in the shell: core, streaming, authsome,
warden, vault, trove, keysmith, chronicle, relay, ledger and bastion. The shell
bundles all of them, so every figure below carries other sessions' plugins and
uncommitted work as well as warden's. There is no "without warden" build here,
and the eager total is not warden's share. Nothing in this section is meant to
isolate it.

Thirty JS chunks are emitted. The eager set is the entry plus everything it
imports with `from"./..."`, read from the built entry's static import
statements. It is the entry and eleven small chunks, and none of those eleven
imports anything outside the set.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| `index` (entry) | 1,231.14 KB | 331.87 KB | eager |
| `page-header` | 59.92 KB | 22.19 KB | eager, static from the entry |
| `confirm-dialog` | 55.91 KB | 18.63 KB | eager, static from the entry |
| `utils` | 27.26 KB | 8.69 KB | eager, static from the entry |
| `jsx-runtime` | 8.55 KB | 3.26 KB | eager, static from the entry |
| `with-selector` | 5.11 KB | 1.91 KB | eager, static from the entry |
| `createLucideIcon` | 2.88 KB | 1.52 KB | eager, static from the entry |
| `label` | 2.81 KB | 1.34 KB | eager, static from the entry |
| `empty-state` | 2.68 KB | 1.03 KB | eager, static from the entry |
| `detail-layout` | 2.43 KB | 1.05 KB | eager, static from the entry |
| `input` | 2.39 KB | 1.24 KB | eager, static from the entry |
| `none-cell` | 0.24 KB | 0.21 KB | eager, static from the entry |
| `chart` (recharts) | 330.52 KB | 97.24 KB | lazy, with Usage or Activity |
| `dist-C1o7dCB9` (CodeMirror core, holds `EditorView`) | 288.56 KB | 93.24 KB | lazy |
| `graph-canvas` (React Flow and dagre) | 217.19 KB | 69.69 KB | lazy |
| `dist-yY4JzDLC` (CodeMirror, search) | 43.12 KB | 14.15 KB | lazy |
| `ledger-table` | 30.50 KB | 9.59 KB | lazy |
| `dist-BTo3Thc2` (CodeMirror) | 28.03 KB | 9.82 KB | lazy |
| `schema` (warden's schema editor page) | 24.45 KB | 9.26 KB | lazy |
| `json-diff` | 20.43 KB | 7.70 KB | lazy |
| `config-detail` | 20.35 KB | 6.17 KB | lazy |
| `usage` | 9.89 KB | 3.70 KB | lazy |
| `invoice-detail` | 9.67 KB | 3.51 KB | lazy |
| `value` (shared by `chart` and `graph-canvas`) | 9.22 KB | 3.96 KB | lazy |
| `event-detail` | 6.79 KB | 2.43 KB | lazy |
| `plan-detail` | 6.09 KB | 2.23 KB | lazy |
| `activity` | 5.79 KB | 2.37 KB | lazy |
| `json-editor` (three chunks, one per wrapper) | 1.75 / 1.20 / 1.20 KB | 0.92 / 0.67 / 0.67 KB | lazy |

The eager set is 1,401.32 KB raw and 392.94 KB gzip (the sum of the figures
above), against 1,303.76 KB and 366.51 KB in the ledger section. That is 97.56
KB raw and 26.43 KB gzip more, from three more plugins (trove, keysmith,
bastion), warden's eager pages and whatever else landed in the shared tree in
the meantime. It is not warden's graphs or editor, which are lazy.

### CodeMirror

CodeMirror lives in three `dist-*` chunks of 288.56, 43.12 and 28.03 KB raw
(93.24, 14.15 and 9.82 KB gzip), 359.71 KB raw and 117.21 KB gzip together,
and all three are lazy. `EditorView` and `cm-editor` are in `dist-C1o7dCB9`,
the only built file that matches `codemirror` or `cm-editor`. The search
bindings are in `dist-yY4JzDLC`.

Warden's schema editor is the `schema` chunk, 24.45 KB raw. It statically
imports `dist-C1o7dCB9` and `dist-yY4JzDLC`, so opening it loads about 356 KB
raw and 117 KB gzip in total, on first open only. It reaches the shell through
a `lazy()` call in the entry. `schema-C5gDbhA5` appears in the entry twice,
once in `__vite__mapDeps` and once in that `import()`, and never in a
`from"./..."` clause. The vault editor, the diff and the relay and chronicle
viewers share these chunks, as before.

### React Flow and dagre

React Flow and dagre are in `graph-canvas`, 217.19 KB raw and 69.69 KB gzip,
and nowhere else: `grep -l` for `ReactFlow` and for `dagre` over every built
asset lists only `graph-canvas-*.js`. Its stylesheet, `graph-canvas-*.css`
(15.41 KB raw, 2.56 KB gzip), is lazy with it and is not part of the entry's
CSS. Two `lazy()` calls in the entry import it, and the chunk name shows up three
times in the entry: those two `import()` calls and `__vite__mapDeps`. There is no static
`from"./graph-canvas-..."`. Opening a graph loads `graph-canvas`, the shared
`value` chunk and the stylesheet: 226.41 KB raw and 73.65 KB gzip of JS, plus
the CSS.

### The entry does not carry either

Counts in the built entry chunk (`index-czdfffDy.js`):

| string | matches |
|---|---|
| `EditorView` | 0 |
| `ReactFlow` | 0 |
| `dagre` | 0 |
| `@codemirror` | 0 |
| `cm-editor` | 0 |
| `react-flow` | 0 |

None of the three heavy chunks (`dist-C1o7dCB9`, `dist-yY4JzDLC`,
`graph-canvas`), nor `dist-BTo3Thc2` or `schema`, has a static `from"./..."`
entry in the built entry chunk, and none of them is in `index.html`'s
`modulepreload` list. Both surfaces are split out, and they are measured as
split, not assumed.

The CSS is 273.94 KB (40.99 KB gzip) for the shell stylesheet, plus the
15.41 KB lazy graph stylesheet above.

## Trove's object browser, and where it lands (2026-10-04)

Measured with `vite build` in `apps/shell` on 2026-10-04, written to a scratch
directory with `--outDir`, the same way as the warden section: `tsc -b` skipped,
sizes in Vite's own kB. The shell still bundles every registered plugin, so the
eager figures carry other sessions' work as well as trove's.

Thirty-three JS chunks are emitted, three more than before. Two of them are
trove's: the browser page and its code view.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| `index` (entry) | 1,241.99 KB | 333.83 KB | eager |
| `page-header` | 59.92 KB | 22.19 KB | eager, static from the entry |
| `confirm-dialog` | 55.91 KB | 18.63 KB | eager, static from the entry |
| `utils` | 27.26 KB | 8.69 KB | eager, static from the entry |
| `jsx-runtime` | 8.55 KB | 3.26 KB | eager, static from the entry |
| `checkbox` | 6.51 KB | 3.01 KB | eager, static from the entry |
| `with-selector` | 5.11 KB | 1.91 KB | eager, static from the entry |
| `createLucideIcon` | 2.88 KB | 1.52 KB | eager, static from the entry |
| `label` | 2.81 KB | 1.34 KB | eager, static from the entry |
| `empty-state` | 2.68 KB | 1.03 KB | eager, static from the entry |
| `detail-layout` | 2.43 KB | 1.05 KB | eager, static from the entry |
| `input` | 2.39 KB | 1.24 KB | eager, static from the entry |
| `none-cell` | 0.24 KB | 0.21 KB | eager, static from the entry |
| `browser` (trove's object browser) | 86.27 KB | 26.99 KB | lazy, when you open a bucket |
| `code-view` (trove's text preview) | 1.23 KB | 0.70 KB | lazy, the first time a text preview shows |

The eager set is 1,418.68 KB raw and 397.91 KB gzip, against 1,401.32 KB and
392.94 KB in the warden section: 17.36 KB raw and 4.97 KB gzip more. A new
eager `checkbox` chunk is 6.51 KB of that, and the rest is whatever landed in
the shared tree since. None of it is the browser, which is lazy.

### What the browser chunk carries

`browser` holds the listing, the inspector, the share, copy and delete dialogs
and the upload queue. It is the only built file with `useVirtualizer` in it, and
the only one with `X-Trove-Ticket`. It statically imports the entry and ten small
chunks the entry already loaded, and nothing heavy. Opening a bucket costs 86.27 KB raw
and 26.99 KB gzip, once.

### CodeMirror

Trove adds no CodeMirror bytes. `code-view` is a 1.23 KB wrapper that imports
the same three `dist-*` chunks the vault, relay, chronicle and warden editors
already share (`dist-C1o7dCB9`, `dist-yY4JzDLC`, `dist-BTo3Thc2`, 359.71 KB raw
and 117.21 KB gzip together, the same hashes as the warden section). `browser`
reaches `code-view` only through `import()`. The first text preview loads about
361 KB raw and 118 KB gzip, unless another plugin's editor already did.

### The entry does not carry any of it

Counts in the built entry chunk (`index-BvsKMWki.js`):

| string | matches |
|---|---|
| `EditorView` | 0 |
| `@codemirror` | 0 |
| `cm-editor` | 0 |
| `useVirtualizer` | 0 |
| `react-virtual` | 0 |
| `measureElement` | 0 |
| `trove/content` | 0 |
| `X-Trove-Ticket` | 0 |
| `beginUpload` | 0 |
| `webkitGetAsEntry` | 0 |

The entry names `browser-Bn9Tqny5.js` twice, once in `__vite__mapDeps` and once
in the `import()` the route's `lazy()` compiles to, and never in a
`from"./..."` clause. Neither trove chunk is in `index.html`'s `modulepreload`
list. The CSS is unchanged at 273.94 KB (40.99 KB gzip).

## Sentinel's prompt diff, and where it lands (2026-10-05)

Measured with `vite build` in `apps/shell` on 2026-10-05, written to a scratch
directory with `--outDir`, the same way as the trove section: `tsc -b` skipped,
sizes in Vite's own kB. The shell bundles every registered plugin, so the eager
figures carry other sessions' work as well as sentinel's, and this section does
not try to split the two.

Forty-four JS chunks are emitted, eleven more than in the trove section. Two
are sentinel's: the prompt version page and the diff it opens.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| `index` (entry) | 1,320.35 KB | 352.41 KB | eager |
| `page-header` | 59.92 KB | 22.19 KB | eager, static from the entry |
| `confirm-dialog` | 53.10 KB | 17.75 KB | eager, static from the entry |
| `utils` | 27.26 KB | 8.69 KB | eager, static from the entry |
| `jsx-runtime` | 8.55 KB | 3.26 KB | eager, static from the entry |
| `react-dom` | 3.55 KB | 1.34 KB | eager, static from the entry |
| `useTransitionStatus` | 2.94 KB | 1.27 KB | eager, static from the entry |
| `label` | 2.82 KB | 1.34 KB | eager, static from the entry |
| `empty-state` | 2.68 KB | 1.03 KB | eager, static from the entry |
| `input` | 2.40 KB | 1.25 KB | eager, static from the entry |
| `with-selector` | 1.63 KB | 0.72 KB | eager, static from the entry |
| `createBaseUIEventDetails` | 1.57 KB | 0.85 KB | eager, static from the entry |
| `badge` | 1.45 KB | 0.67 KB | eager, static from the entry |
| `createLucideIcon` | 1.38 KB | 0.77 KB | eager, static from the entry |
| `detail-layout` | 1.03 KB | 0.51 KB | eager, static from the entry |
| `useValueChanged` | 0.70 KB | 0.44 KB | eager, static from the entry |
| `none-cell` | 0.24 KB | 0.21 KB | eager, static from the entry |
| `visuallyHidden` | 0.19 KB | 0.16 KB | eager, static from the entry |
| `prompt-version` (sentinel's version page) | 3.26 KB | 1.34 KB | lazy, when you open a prompt version |
| `prompt-diff` (sentinel's diff) | 0.95 KB | 0.60 KB | lazy, the first time a version's prompt differs from the one before |

The eager set is 1,491.76 KB raw and 414.86 KB gzip, against 1,418.68 KB and
397.91 KB in the trove section: 73.08 KB raw and 16.95 KB gzip more. The
`checkbox` chunk is gone from the eager set and six small ones joined it
(`react-dom`, `useTransitionStatus`, `createBaseUIEventDetails`, `badge`,
`useValueChanged`, `visuallyHidden`). The entry itself grew by 78.36 KB raw
(1,241.99 to 1,320.35), which is more than the 73.08 KB the whole set grew by,
so the other eager chunks shrank a little between the two builds. Neither
sentinel chunk is part of the growth, because both are lazy.

### What the diff carries

`prompt-version` is the version page: the details, the prompt as text and the
"Changes from" section. It imports the entry and four small chunks the entry
already loaded (`page-header`, `detail-layout`, `none-cell`, `jsx-runtime`), and
it reaches `prompt-diff` only through `import()`. Nothing in it is heavy, so
opening a prompt version costs 3.26 KB raw and 1.34 KB gzip. A first version, or
one whose prompt matches the version before it, never loads the diff.

### CodeMirror

Sentinel adds one CodeMirror wrapper and no CodeMirror bytes of its own.
`prompt-diff` is 0.95 KB and imports three chunks: two CodeMirror chunks and
`jsx-runtime`, which the entry already loads. The CodeMirror ones are
`dist-C1o7dCB9` (the core, 288.56 KB raw and 93.24 KB gzip, the same hash as the
trove and warden sections) and `dist-v479ndfu` (19.50 KB raw and 7.29 KB gzip).
The second is the chunk with `@codemirror/merge` in it. Of vault's pages, only
`json-diff` imports it statically. `config-detail` reaches it lazily. Either
way, a vault diff and a prompt diff share the one chunk. The earlier sections
did not name it.

The first time you open a version whose prompt changed, you load about 312.27 KB
raw and 102.47 KB gzip (the page, the diff and those two chunks), or 4.21 KB raw
and 1.94 KB gzip if a vault diff or another editor already loaded the shared
two. The other two `dist-*` chunks (`dist-yY4JzDLC`, `dist-BTo3Thc2`) are not
imported by `prompt-diff`.

### The entry does not carry any of it

Counts in the built entry chunk (`index-DHEp2CI5.js`):

| string | matches |
|---|---|
| `EditorView` | 0 |
| `@codemirror` | 0 |
| `cm-editor` | 0 |
| `unifiedMergeView` | 0 |

The entry names `prompt-version-BvyayMiz.js` twice, once in `__vite__mapDeps`
and once in the `import()` the route's `lazy()` compiles to, and never in a
`from"./..."` clause. It does not name `prompt-diff` at all. That chunk is named
only inside `prompt-version`, in its own `__vite__mapDeps` and its `import()`.
Neither sentinel chunk is in `index.html`'s `modulepreload` list (count 0). The
CSS is 274.43 KB (41.07 KB gzip), 0.49 KB more than in the trove section.

The chunk hashes named in this section are from this build. Any edit to the
entry changes them, so search by chunk name if you repeat the counts.

## Herald's template workspace, and where it lands (2026-10-06)

Measured with `vite build` in `apps/shell` on 2026-10-06, written to scratch
directories with `--outDir`, the same way as the sentinel section: `tsc -b`
skipped, sizes in Vite's own kB. This time the shell was built twice, with
Herald and without it (its import and its array entry removed from `App.tsx`
for the second build, then put back byte for byte), so the difference is
Herald's own. Both builds carry everyone else's current work. The section was
re-measured after the editor theme moved into its own module, so every figure
and chunk name below is from that second pair of builds.

Fifty-three JS chunks are emitted with Herald, nine more than in the sentinel
section, and forty without it. Eight of the thirteen Herald adds are its own
lazy chunks: `template-workspace`, `code-editor`, `field-diff`,
`provider-create`, `provider-edit` and `secret-fields`, plus two new CodeMirror
chunks. The other five are the net of six chunks that joined the eager set and one
(`checkbox`) that left it.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| `index` (entry) | 1,425.55 KB | 377.17 KB | eager |
| `page-header` | 59.92 KB | 22.19 KB | eager, static from the entry |
| `confirm-dialog` | 53.10 KB | 17.75 KB | eager, static from the entry |
| `utils` | 27.26 KB | 8.69 KB | eager, static from the entry |
| `jsx-runtime` | 8.55 KB | 3.26 KB | eager, static from the entry |
| `CompositeRoot` | 6.93 KB | 2.90 KB | eager, static from the entry |
| `react-dom` | 3.55 KB | 1.34 KB | eager, static from the entry |
| `useTransitionStatus` | 2.94 KB | 1.27 KB | eager, static from the entry |
| `empty-state` | 2.68 KB | 1.03 KB | eager, static from the entry |
| `useRegisterFieldControl` | 2.44 KB | 1.17 KB | eager, static from the entry |
| `input` | 2.41 KB | 1.26 KB | eager, static from the entry |
| `with-selector` | 1.63 KB | 0.72 KB | eager, static from the entry |
| `native-select` | 1.63 KB | 0.77 KB | eager, static from the entry |
| `createBaseUIEventDetails` | 1.57 KB | 0.85 KB | eager, static from the entry |
| `badge` | 1.45 KB | 0.67 KB | eager, static from the entry |
| `createLucideIcon` | 1.38 KB | 0.77 KB | eager, static from the entry |
| `detail-layout` | 1.03 KB | 0.51 KB | eager, static from the entry |
| `useValueChanged` | 0.70 KB | 0.44 KB | eager, static from the entry |
| `none-cell` | 0.24 KB | 0.21 KB | eager, static from the entry |
| `visuallyHidden` | 0.19 KB | 0.16 KB | eager, static from the entry |
| `template-workspace` (herald's workspace page) | 35.75 KB | 10.85 KB | lazy, when you open a template |
| `theme` (herald's theme module, with `lang-html` and `autocomplete` hoisted into it) | 170.63 KB | 67.86 KB | lazy, with the first editor |
| `dist-BbfPcjfC` (CodeMirror, lint) | 13.28 KB | 5.21 KB | lazy, with the first editor |
| `code-editor` (herald's editor) | 5.21 KB | 2.33 KB | lazy, when the workspace draws its first field |
| `field-diff` (herald's diff) | 1.33 KB | 0.71 KB | lazy, when you open Review changes |
| `provider-edit` | 9.35 KB | 2.86 KB | lazy, when you edit a provider |
| `provider-create` | 7.34 KB | 2.46 KB | lazy, when you add a provider |
| `secret-fields` (shared by the two) | 0.93 KB | 0.51 KB | lazy, with either provider form |

The eager set is 1,605.15 KB raw and 443.13 KB gzip with Herald, and 1,537.43 KB
and 425.45 KB without it. The difference is 67.72 KB raw and 17.68 KB gzip, and
that is what every operator pays for Herald before opening any of its pages:
its plugin entry and the pages the entry imports statically. The entry accounts
for most of it (1,359.32 to 1,425.55 KB raw, 66.23 KB more; 360.62 to 377.17 KB
gzip). Six small chunks joined the eager set (`CompositeRoot`, `react-dom`,
`useTransitionStatus`, `badge`, `useValueChanged` and `visuallyHidden`) and
`checkbox` left it, while `confirm-dialog` shrank by 2.81 KB, so the rest of the
set moved by a net 1.49 KB raw. Against the sentinel section's 1,491.76 KB
and 414.86 KB the eager set is 113.39 KB raw and 28.27 KB gzip larger, which is
Herald plus whatever else other sessions landed in the meantime. Nothing in the
workspace, the editors or the diff is in that figure, because all of it is lazy.

### What the workspace carries

`template-workspace` is the page: the rail, the editor tabs, the preview, the
problems list, the review dialog and the settings tab. It imports eight chunks
statically and every one is already in the eager set (the entry, `badge`,
`confirm-dialog`, `input`, `jsx-runtime`, `native-select`, `page-header` and
`utils`), so opening a template costs 35.75 KB raw and 10.85 KB gzip before any
editor loads. It reaches `code-editor` and `field-diff` only through `import()`
(the two `lazy()` calls in `components/editor/lazy.tsx`), and the page shows the
field's text in a plain `pre` until the editor arrives.

### CodeMirror

None of the earlier sections has a chunk for HTML, completion or linting, so
Herald adds two CodeMirror chunks of its own. The first is `theme` (170.63 KB
raw, 67.86 KB gzip). It is Herald's own theme module, the highlight style and
editor theme that `code-editor` and `field-diff` share, and Rollup hoisted
`lang-html` and `autocomplete` into it because it is the one chunk both editors
import them through, which is why a 170 KB chunk carries a small name. The
second is `dist-BbfPcjfC` (13.28 KB raw, 5.21 KB gzip, `lint`). Together they
are 183.91 KB raw and 73.07 KB gzip. The editors also use three chunks the other
plugins already load: the core (`dist-DTPZDTh4`, holding `EditorView`), the
search chunk (`dist-BJrTTN7H`) and the lezer parser chunk (`dist-Y1X1QIEL`). The
diff uses the `@codemirror/merge` chunk (`dist-PNYeBczq`, 19.50 KB raw and 7.30
KB gzip), the chunk the vault and sentinel diffs already load.

Every `dist-*` hash in this build differs from the earlier sections, and that is
a consequence of the core's hash changing, not of the other chunks changing.
The merge chunk and the search chunk are the same size in raw KB as before
(19.50 and 43.12 KB). The core itself grew from 288.56 to 296.22 KB raw (93.24 to
95.70 KB gzip), and the lezer chunk from 28.03 to 28.35 KB (9.82 to 9.93 KB
gzip), most likely because Herald uses more of the packages they hold. Which
modules account for it wasn't traced. The three shared chunks are now 367.69 KB raw and 119.69 KB gzip
together, against 359.71 KB and 117.21 KB in the trove section.

The first time you open a template cold, you load about 592.56 KB raw and 205.94
KB gzip: the workspace, the editor and its five chunks. If another plugin's
editor already loaded the core, search and lezer chunks, it is 224.87 KB raw and
86.25 KB gzip (the workspace, the editor, `theme` and `lint`). Review
changes loads `field-diff` as well, which is 1.33 KB raw and 0.71 KB gzip once
the merge chunk and `theme` are in, and 20.83 KB raw and 8.01 KB gzip if the
merge chunk is not. `code-editor` and `field-diff` import five and four
CodeMirror chunks respectively (`theme` among them), and the workspace's
`__vite__mapDeps` lists them all, so Vite preloads them in parallel when the
editor is first drawn.

### The entry does not carry any of it

Counts in the built entry chunk (`index-ChFckgZ6.js`):

| string | matches |
|---|---|
| `EditorView` | 0 |
| `@codemirror` | 0 |
| `cm-editor` | 0 |
| `lang-html` | 0 |
| `unifiedMergeView` | 0 |
| `htmlLanguage` | 0 |

The entry names `template-workspace-Tewg7ZOD.js` twice, once in
`__vite__mapDeps` and once in the `import()` the route's `lazy()` compiles to,
and never in a `from"./..."` clause. It does not name `code-editor` or
`field-diff` at all. Those two are named only inside `template-workspace`, in its
own `__vite__mapDeps` and its two `import()` calls. The workspace chunk is not
in `index.html` (0 matches), and none of the CodeMirror chunks is in its
`modulepreload` list, which names 19 chunks with Herald and 14 without. The CSS
is 276.04 KB (41.34 KB gzip) in both builds, 1.61 KB more than in the sentinel
section. Taking Herald out of `App.tsx` does not change it, because Tailwind
scans the sources either way.

The chunk hashes named in this section are from this build. Any edit to the
entry changes them, so search by chunk name if you repeat the counts.

## Sentinel's charts and comparison, and where they land (2026-10-07)

Measured with `vite build` in `apps/shell` on 2026-10-07, written to a scratch
directory with `--outDir` like the sections above: `tsc -b` skipped, sizes in
Vite's own kB. There are two builds this time, the tree as it stands and the
same tree with `sentinelPlugin` taken out of `App.tsx`, so sentinel's share of
the eager set can be read off directly. The other plugins' commits since the
Herald section are in both builds.

| chunk | raw | gzip | loaded |
|---|---|---|---|
| eager, with sentinel | 1,648.03 KB | 454.26 KB | eager (22 scripts) |
| eager, without sentinel | 1,547.86 KB | 430.91 KB | eager (20 scripts) |
| `trend-chart` (pass rate over runs) | 7.57 KB | 3.03 KB | lazy, when a suite's Runs tab has two completed runs |
| `dimension-trends` (a line per dimension) | 1.83 KB | 0.93 KB | lazy, with the trend chart |
| `LineChart` (Recharts' line parts) | 14.63 KB | 4.75 KB | lazy, with either line chart |
| `XAxis` (Recharts' axis parts) | 10.11 KB | 3.15 KB | lazy, with any Recharts chart |
| `compare` (the comparison page) | 9.13 KB | 3.05 KB | lazy, when you open a comparison |
| `prompt-diff` (the diff, shared with the prompt version page) | 0.95 KB | 0.60 KB | lazy, when you open a case's outputs and the two runs gave different ones (a red-team case's only after you reveal them) |

Sentinel costs the eager set 100.17 KB raw and 23.35 KB gzip. That is every
sentinel page that isn't a lazy route, from 4a's suites and cases to 4c's run
charts and red team, which are plain elements and ship with their pages. Against
the Herald section's 1,605.15 KB raw and 443.13 KB gzip the eager set is 42.88
KB raw and 11.13 KB gzip larger, and that difference carries other sessions'
work as well.

### Recharts stays out of the entry

The two line charts are reached only through `lazy()` from the trend section,
and they share the kit's `chart` chunk with Chronicle's, Ledger's and
Keysmith's charts: 313.61 KB raw and 93.65 KB gzip, Recharts itself. Adding
`Line`, `LineChart` and `ReferenceLine` to the kit's re-exports split two small
chunks out of it, `LineChart` and `XAxis`. Opening a suite's Runs tab cold loads
347.75 KB raw and 105.51 KB gzip: the two charts, the `chart` chunk and those
two. If another plugin's chart already loaded the `chart` chunk, sentinel's own
part is the two chart chunks plus `LineChart`, 24.03 KB raw and 8.71 KB gzip.
A suite with fewer than two completed runs never loads any of it.

### The comparison reuses the diff

`compare` imports only chunks the entry already loads (`button`, `format`,
`none-cell`, `page-header`, `jsx-runtime` and the entry), and reaches the diff
through `output-diff`, which only it imports, and a second `import()`. The diff
is the same `prompt-diff` chunk the prompt version page opens, and it imports
the same two CodeMirror chunks: `dist-DTPZDTh4` (the core, 296.22 KB raw and
95.70 KB gzip) and `dist-PNYeBczq` (19.50 KB raw and 7.30 KB gzip, with
`@codemirror/merge` in it). Opening a comparison costs 9.13 KB raw and 3.05 KB
gzip, and the CodeMirror chunks only load when you open a case's outputs and
both runs gave different ones.

### What the eager scripts carry

All 22 scripts `index.html` loads were searched for `recharts` and for
`@codemirror`, `cm-editor` and `EditorView`. Every count is 0, the entry
(`index-D3q1FRwZ.js`) included. `index.html` names none of `trend-chart`,
`dimension-trends` or `compare` (0 matches), so none of them is modulepreloaded.

The CSS is 278.05 KB (41.63 KB gzip) in both builds, 2.01 KB more than in the
Herald section. Taking sentinel out of `App.tsx` doesn't change it, because the
shell's `styles.css` scans every plugin package's sources either way.

The chunk hashes named here are from this build. Any edit to the entry changes
them, so search by chunk name if you repeat the counts.

## Shield editor (2026-10-08)

A production Vite build of the current shell emits Shield's structured editor
as a separate `editor-*.js` chunk: 11.65 kB raw, 4.15 kB gzip. CodeMirror stays
behind the editor's dynamic import; overview and record routes do not import it.
The shared CodeMirror chunk is 296.22 kB raw, 95.70 kB gzip and is also lazy.
The whole shell entry is 1,543.59 kB raw, 403.13 kB gzip across the current plugin
composition. This is a measurement, not a passing bundle-budget claim.

Command: `pnpm --filter @forge-go/dashboard-shell exec vite build --outDir
/tmp/shield-icon-shell-build`. The ordinary shell build remains blocked by existing
concurrent errors in `src/design-preview/DashboardPreview.tsx` at lines 878/885.

The final entry is `index-Cvp7epr0.js`. Its static import closure contains 30
chunks; Shield's `editor-DqURcWUZ.js` and the shared CodeMirror
`dist-DTPZDTh4.js` are outside that closure and are not modulepreloaded.

## Nexus read pages, 2026-10-08

Measured with Node 24.16.0, pnpm 10.21.0 and Vite 8.2.2:

```sh
pnpm --filter @forge-go/dashboard-shell exec vite build --outDir /tmp/nexus-slice5-dist
```

| Asset | Raw bytes | gzip bytes |
|---|---:|---:|
| Shell entry `index-C1ICKXkW.js` | 1,589,011 | 410,832 |
| Nexus usage route `usage-S_XpNnBT.js` | 4,587 | 1,768 |
| Shared chart chunk `chart-B8nb_26p.js` | 313,613 | 92,373 |
| Shell CSS `index-CZ77grf8.css` | 280,726 | 41,508 |

These are whole-host measurements with the other plugins installed. They don't
isolate Nexus's contribution to the entry. gzip sizes use Python's gzip module.
Nexus's usage route is lazy; at this slice it contains tables and doesn't import
the chart chunk. Slice 6 adds charts and must measure the resulting split again.

The production bundle succeeded. The combined shell build was blocked by two
concurrent design-preview type errors in `DashboardPreview.tsx`: an unsupported
`scopes` prop and an implicitly typed callback parameter. The Next example's
production build passed with `FORGE_DASHBOARD_URL` set; its admin route was 196 kB
and 299 kB on first load. Nexus package typecheck, lint and tests passed.

All ten Nexus read routes were checked at 1440 by 1000 and 390 by 844. No page
overflow was found; wide tables scroll within their containers. The browser pass
also covered delayed gateway loading, a filtered-empty tenant list, model query
failures and retry, usage collection off, open HTTP access, and the key-to-history
link. Captures are local under `output/playwright/nexus-slice5/`. These fixture
checks don't qualify a deployed gateway, dashboard authentication or durable
idempotency storage.

## Nexus write flows and charts, 2026-10-08

After adding tenant forms, key commands and the two usage charts, the Vite bundle
passed with `pnpm --filter @forge-go/dashboard-shell exec vite build --manifest`.
The manifest's recursive static imports for `index.html` contain 27 entries and
exclude both Nexus usage and every chart chunk. The lazy Nexus usage entry imports
the shared chart, BarChart and XAxis chunks. No charting dependency was added.

| Asset | Raw bytes | gzip bytes |
|---|---:|---:|
| Shell entry `index-BKHSKRpz.js` | 1,602,634 | 415,003 |
| Nexus usage route `usage-vGwBJSTq.js` | 8,022 | 2,909 |
| Shared chart chunk `chart-qQrjOSdm.js` | 313,576 | 92,334 |
| Shell CSS `index-CAIXemX-.css` | 281,141 | 41,533 |

These are whole-host sizes using Python gzip, with concurrent plugins installed.
Spend bars start at zero and show height relative to the largest bucket. The peak,
tooltip and table use exact decimal strings. Values outside the numeric chart
range fall back to the table with an explicit explanation. A pending filter change
retains the previous labelled selection at reduced opacity.

All 54 Nexus React tests, package typecheck and lint passed after package formatting.
The source import-graph regression confirms only Usage reaches chart modules; a
separate source check rejects numeric decimal coercion outside chart adapters.
Browser write and chart verification is recorded after the final interaction pass.

Browser verification used fresh fixture state on ports 8198/5198, plus the
collection-off fixture on 8197/5197. All 12 routes rendered at 1440 by 1000 and
390 by 844 without page overflow. Wide tables retain their own scroll area.
Tenant create/edit and all status transitions persisted. Global and tenant key
creation, immediate rotation and revocation updated subsequent reads. Both reveal
flows resisted Escape/backdrop dismissal, guarded unload and required storage
acknowledgement. A clipboard failure selected the key for manual copying; masked
screenshots keep fixture secrets out of artifacts. A forced revoke failure stayed
inside its dialog and succeeded on retry. Exact tooltip/table values, delayed
scope retention, empty usage and collection-off states were checked in-browser.
Captures and safe boolean results are in `output/playwright/nexus-slice6/`.

The full workspace typecheck passed 27 packages. The repeated workspace test run
passed 25 of 26 packages, including all 54 Nexus tests; eight failures remain in
an unrelated untracked host `setup-screen.test.tsx`. The first full run exposed a
one-second lazy-import assertion timeout under concurrent load; its wait now
allows ten seconds while retaining the same route assertions. Composed Nexus
link actions now declare their non-button element to Base UI.

All 18 Nexus HTTP intents and 12 spot checks passed. The full fixture verifier
passed 419 calls and retained 49 Shield failures, with no Nexus failures. The
Next production build passed (admin route 210 kB, first load 312 kB). The shell
Vite bundle passed; its combined TypeScript/build command remains blocked by the
unrelated preview's unsupported `scopes` prop and implicit callback `id` type.
Browser console findings were missing unrelated contributors, favicon 404 and
the deliberately injected revoke 503. These checks don't qualify installed
permissions, provider credentials or a deployment's durable idempotency store.

The Slice 6 review fix pass passed all 66 Nexus tests, package formatting, lint
and typecheck. An untouched model list or metadata map is now omitted before
normalization or validation. Tenant drafts survive transient refresh failure and
retry; denied, missing and cleared contexts discard them.

Browser Back was checked while a key command was pending, uncertain and revealed,
including repeated Back. Both the Navigation API path and a run with that API
unavailable preserved the dialog and retry identity. Back worked after storage
acknowledgement. The fallback listener loads with the plugin before BrowserRouter;
window popstate listeners do not gain priority from capture mode. A browser
refresh failure and retry also preserved the tenant draft. Evidence is in
`output/playwright/nexus-slice6/review-regressions-result.txt`; screenshots mask keys.

## Dispatch durable inspection, 2026-10-09

Both durable routes and the existing Dispatch JSON viewer remain lazy. The Vite
manifest's recursive static imports from `index.html` contain 28 entries and
exclude the durable list, durable detail, JSON viewer and its editor imports.
No editor or graph dependency was added.

| Asset                                          | Raw bytes | gzip bytes |
| ---------------------------------------------- | --------: | ---------: |
| Shell entry `index-XHx3iA_c.js`                | 1,642,456 |    426,611 |
| Durable list `durable-executions-21JAP1yg.js`  |     4,455 |      1,762 |
| Durable detail `durable-execution-DimE89vm.js` |    10,838 |      3,615 |
| Existing JSON viewer `json-view-CDilcUGJ.js`   |     1,203 |        689 |
| Shell CSS `index-BtApM4Ng.css`                 |   281,817 |     41,626 |

These are whole-host sizes with concurrent Conduit work installed, measured with
Python gzip. They do not isolate Dispatch's contribution to entry growth.
`pnpm --filter @forge-go/dashboard-shell exec vite build --manifest --outDir
/Users/rexraphael/Work/xraph/forge-dashboard/output/dispatch-task2-bundle
--emptyOutDir` retained an isolated measurement after concurrent builds replaced
the shared `dist` manifest. The configured root production build passed all three
tasks. Its Next admin route measured 212 kB, with 314 kB first load. Vite retained
its large-chunk and future native-config-loader warnings; Turbo retained its
missing output declaration warning for the Next build.

All 54 Dispatch React tests passed. Workspace lint passed 27 tasks, typecheck
passed 28 tasks, and the playbook's recursive test command passed 5,923 tests
across 27 packages. Shared cancellation changes passed 246 tests and independent
review. Real Go HTTP checks covered all durable reads, separate payload authority,
401/403/404/400 responses and stripped browser authority headers. Desktop and
narrow list/detail pages had no page overflow. Browser checks covered incomplete
discovery continuation, filtered emptiness, foreign scope denial, exact encoded
identity, run links, source delivery distinctions, visible polling, payload reveal
and hide, plus PostgreSQL stale data and retry.

The qualification proxy's shell bootstrap is fixture-only. Domain requests use
actual Forge/Authsome/Warden HTTP with memory or PostgreSQL Dispatch storage.
Hidden-tab cancellation and high-integer boundaries are unit/wire verified;
this browser session kept reporting visible, and an artificial PostgreSQL boundary
insert was rejected by the durable delivery intent guard. No guard was bypassed.
These pages do not qualify deployed login, runtime execution, recovery, remote
webhook completion, Chronicle anchoring or the separate legacy migration.

## Dispatch durable inspection correction, 2026-10-09

The versioned identity routes and context-reset cursor correction keep both durable
pages and the JSON viewer lazy. The isolated Vite manifest still has 28 recursive
static entries from `index.html`; neither durable route nor the JSON viewer is in
that closure. You can regenerate earlier durable detail bookmarks from the list.

| Asset                                   | Raw bytes | gzip bytes |
| --------------------------------------- | --------: | ---------: |
| `assets/json-view-CDilcUGJ.js`          |     1,203 |        689 |
| `assets/durable-execution-CNn_hyKI.js`  |    11,224 |      3,755 |
| `assets/durable-executions-DGY_eCws.js` |     4,471 |      1,766 |
| `assets/index-YtSwggpV.js`              | 1,642,555 |    426,632 |
| `assets/index-Dh3vOyfJ.css`             |   281,573 |     41,897 |

These are whole-host shared-checkout measurements after concurrent Kit trial and
Conduit work. They do not isolate Dispatch entry growth. The manifest came from
`pnpm --filter @forge-go/dashboard-shell exec vite build --manifest --outDir
/Users/rexraphael/Work/xraph/forge-dashboard/output/dispatch-task2-fix1-bundle
--emptyOutDir`. The configured root build passed all three tasks. Existing Vite
native-loader and large-chunk warnings, and the Turbo Next output warning remain.

Installed-router tests and the real Go HTTP browser matrix preserve literal `%2F`,
slash, bare percent and Unicode in all three identity positions. Context reset,
client replacement, ignored abort and rejected-continuation recovery are mounted
React/shared-store verified. The browser checks cover seeded reads and manual
discovery restart; they do not qualify a deployed identity-switch flow.

## Dispatch durable identity and reader-policy correction, 2026-10-09

Both identity decoders preserve leading U+FEFF, and active shared readers determine
context-reset policy. The isolated Vite manifest still has 28 recursive eager
entries, excluding both durable routes and the JSON viewer/editor imports.

| Asset                                   | Raw bytes | gzip bytes |
| --------------------------------------- | --------: | ---------: |
| `assets/index-DV60bFRc.js`              | 1,649,983 |    426,638 |
| `assets/durable-executions-B-JbsKPW.js` |     4,471 |      1,763 |
| `assets/durable-execution-DKCsEBCV.js`  |    11,232 |      3,760 |
| `assets/json-view-CDilcUGJ.js`          |     1,203 |        689 |
| `assets/index-DagtfqOd.css`             |   278,214 |     41,538 |

Measurements use Python gzip after concurrent Kit density commit `d6d9254`, with
Conduit already installed. They describe the whole shared checkout; they do not
attribute entry or CSS changes to Dispatch. The isolated command was
`pnpm --filter @forge-go/dashboard-shell exec vite build --manifest --outDir
/Users/rexraphael/Work/xraph/forge-dashboard/output/dispatch-task2-fix2-bundle
--emptyOutDir`. Root lint, types, all 5,974 tests across 27 packages and configured
production build passed. Existing build warnings, two Authsome jsdom navigation
errors and Vitest performance suggestions remain disclosed in the correction
report. Leading U+FEFF reached real Go unchanged in all identity positions;
shared-policy transitions and mixed-reader recovery are mounted React/store
verified, with the deployed identity-switch boundary unchanged.

## Dispatch durable commands and manual query, 2026-10-09

You can start, signal with start, signal an explicit run and request cancellation
through the durable pages. Submitted retries retain their original identity and
bytes in page memory. Protected queries remain manual and outside the shared
cache. Exact-byte file inputs preserve CRLF, BOM and binary data; text entry uses
the browser editor's current value.

Both durable routes, their shared controls and the existing JSON viewer remain
outside the recursive eager entry closure, which has 29 entries in this build.
The shared durable-table chunk now includes the command/query controls.

| Asset                                   | Raw bytes | gzip bytes |
| --------------------------------------- | --------: | ---------: |
| `assets/index-JCF-Hwwj.js`              | 1,653,022 |    427,396 |
| `assets/durable-executions-B8-gTOn0.js` |     4,741 |      1,871 |
| `assets/durable-execution-CN4TLpYm.js`  |    10,206 |      3,366 |
| `assets/durable-table-DHZxejLJ.js`      |    19,486 |      6,632 |
| `assets/json-view-CDilcUGJ.js`          |     1,203 |        689 |
| `assets/index-P_meFCwI.css`             |   279,503 |     41,770 |

These are whole-checkout measurements with concurrent Kit navigation changes,
committed separately as `e7fde9c`. They do not isolate Dispatch entry or CSS growth.
The manifest came from `pnpm --filter @forge-go/dashboard-shell exec vite build
--manifest --outDir /Users/rexraphael/Work/xraph/forge-dashboard/output/dispatch-task3-bundle
--emptyOutDir`; gzip sizes use Python gzip. Root lint, types, all 6,009 tests across
27 packages and configured production build passed. The final focused pass
contains 99 Dispatch tests after an additional inactive-input regression. Existing Vite native-loader
and large-chunk warnings, the Next output declaration warning, Authsome jsdom
navigation diagnostics and Vitest performance suggestions remain disclosed.

Actual Go browser checks cover both atomic signal-start branches, every human
command, original lost-response retry with one persisted start event, exact file
and text bytes, string counters, query mutation refusal, real permission denial,
command invalidation and desktop/narrow layouts. The reviewed fixture's optional
workers-off mode demonstrates cancellation requested while the run remains
running. It is not a drain or readiness qualification. Mounted tests cover client
and context replacement, ignored aborts, private file/read cleanup and hidden-tab
clearing. The browser kept reporting visible when another tab was selected, so
native hidden-tab behavior remains unverified. Shell identity bootstrap remains
fixture-only; domain requests use actual Forge/Authsome/Warden HTTP.

## Dispatch command uncertainty correction, 2026-10-09

Malformed responses and unrecognized command failure codes now retain uncertain
acceptance. A later permission denial keeps that warning and retries the exact
submitted envelope. Only recognized rejection codes establish nonacceptance.

The real scoped-client regression covers malformed 2xx and unfamiliar failure
codes followed by denial, plus a definitive first refusal. All 102 Dispatch tests,
workspace lint and types, and the isolated production bundle passed. The earlier
6,009-test workspace pass remains the full-suite evidence; it was not rerun for
this local classifier correction.

The isolated bundle uses the same command as above with output directory
`output/dispatch-task3-fix1-bundle`. Its 29-entry recursive eager closure still
excludes both durable routes, the shared controls and the JSON viewer.

| Asset                                   | Raw bytes | gzip bytes |
| --------------------------------------- | --------: | ---------: |
| `assets/json-view-CDilcUGJ.js`          |     1,203 |        689 |
| `assets/durable-execution-BdY-P4nt.js`  |    10,206 |      3,365 |
| `assets/durable-executions-B1QLWIxS.js` |     4,741 |      1,870 |
| `assets/durable-table-YTi2wwXH.js`      |    19,515 |      6,624 |
| `assets/index-rKYKDeXD.js`              | 1,653,022 |    427,395 |
| `assets/index-P_meFCwI.css`             |   279,503 |     41,770 |

Measurements describe the shared checkout. Existing browser evidence and its
native visibility and shared focus-warning limits are unchanged. No browser host
was restarted for this response-decoding regression.
