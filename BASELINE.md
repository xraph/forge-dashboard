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
