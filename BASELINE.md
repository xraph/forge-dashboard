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
| entry chunk | 292.43 KB | 88.85 KB | eager, static from `index.html` |
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
| eager entry (entry + rolldown-runtime + Base UI hook chunk) | 432.07 KB | 137.56 KB |

That eager total is well under the 1,065 KB / 322 KB gzip single-chunk
baseline above.

### What the split did and did not do

The eager entry is what the budget governs, and it dropped from 322 KB gzip
to ~137.56 KB. Total bytes did not drop. The default graph in `App.tsx`
renders both heavy blocks on the first screen, so both lazy chunks fetch
immediately and the first view now costs about 1,075.31 KB raw / 329.42 KB
gzip across all six chunks, marginally more than the single 1,065 KB / 322 KB
chunk, because compression is worse across chunk boundaries and Vite does not
modulepreload dynamic-import dependencies, so the two heavy chunks arrive as
a second-stage waterfall rather than in parallel with the entry. What was
bought is time to first paint and a bounded eager budget: the sidebar, header
and stat cards paint without waiting on recharts, TanStack Table or four
@dnd-kit packages. A route that does not render `organism.chart` or
`organism.data-grid` pays nothing for them at all.
