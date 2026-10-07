import { formatDelta, formatScore } from "../format"

export interface DumbbellRow {
  key: string
  label: string
  a: number
  b: number
}

/**
 * Before and after on one 0 to 1 scale: A is a ring, B a filled dot, joined by
 * a line, so the direction reads without colour. Both values and the change
 * are printed in each row, so the marks are never the only way to read them.
 */
export function Dumbbells({ rows, label }: { rows: DumbbellRow[]; label: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`
  return (
    <ul aria-label={label} className="flex flex-col">
      {rows.map((row) => {
        const lo = Math.min(row.a, row.b)
        const hi = Math.max(row.a, row.b)
        return (
          <li
            key={row.key}
            className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3 py-1.5 text-sm"
          >
            <span className="truncate">{row.label}</span>
            <span aria-hidden className="relative mx-2 h-6">
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              <span
                className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground"
                style={{ left: pct(lo), width: `calc(${pct(hi)} - ${pct(lo)})` }}
              />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground bg-background"
                style={{ left: pct(row.a) }}
              />
              <span
                className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
                style={{ left: pct(row.b) }}
              />
            </span>
            <span className="font-mono text-xs tabular-nums whitespace-nowrap">
              {`${formatScore(row.a)} to ${formatScore(row.b)} `}
              <span className="text-muted-foreground">{`(${formatDelta(row.b - row.a)})`}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** The key for the two marks, naming each run. */
export function DumbbellKey({ a, b }: { a: string; b: string }) {
  return (
    <p className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full border-2 border-foreground bg-background" />
        {`A, ${a}`}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="size-2.5 rounded-full bg-foreground" />
        {`B, ${b}`}
      </span>
    </p>
  )
}
