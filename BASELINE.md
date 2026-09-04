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
| `index-CCY_naQy.js` (entry) | 292.43 KB | 88.85 KB | eager, `<script>` |
| `rolldown-runtime-hePW80VL.js` | 0.71 KB | 0.42 KB | eager, modulepreload |
| `useRegisterFieldControl-Bwyn_z63.js` | 138.93 KB | 48.29 KB | eager, modulepreload |
| `chart-area-interactive-DRb8TI6D.js` | 11.92 KB | 3.73 KB | lazy, `organism.chart` |
| `data-table-DcB6hoS3.js` | 274.28 KB | 79.46 KB | lazy, `organism.data-grid` |
| `CompositeRoot-CseDEE6d.js` | 357.04 KB | 108.67 KB | lazy, pulled in only when a lazy chunk that needs it loads |

The three chunks `index.html` actually references up front (`<script>` plus
the two `modulepreload` links) are the real eager cost:

| composition | raw | gzip |
|---|---|---|
| eager entry (index + rolldown-runtime + useRegisterFieldControl) | 432.07 KB | 137.56 KB |

That is well under the 1,065 KB / 322 KB gzip single-chunk baseline above,
with `CompositeRoot` (shared Base UI internals used by both the chart and the
table) and the two heavy blocks themselves now split into chunks that only
load when `organism.chart` or `organism.data-grid` actually renders.
