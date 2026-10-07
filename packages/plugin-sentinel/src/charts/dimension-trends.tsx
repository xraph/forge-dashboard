import { ChartContainer, Line, LineChart, YAxis, type ChartConfig } from "@forge-go/dashboard-kit/components/chart"
import { DIMENSIONS, formatScore, measuredDimensions } from "../format"
import type { TrendPoint } from "../types"

const config = { value: { label: "Score", color: "var(--foreground)" } } satisfies ChartConfig

/**
 * One small line per dimension, every one on the same 0 to 1 scale and in the
 * fixed order, because seven lines on one plot is past what anyone can read. A
 * run that did not measure a dimension leaves a gap: joining its neighbours
 * would draw a value nobody measured. A score with a gap on both sides has no
 * line to sit on, so it gets a dot. The latest value is printed beside each
 * name, so the picture is never the only way to read it.
 */
export default function DimensionTrends({ points }: { points: TrendPoint[] }) {
  const dims = measuredDimensions(points)
  const unmeasured = DIMENSIONS.filter((d) => !dims.includes(d))
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {dims.map((dim) => {
          const rows = points.map((p, index) => ({ index, value: p.dimensionScores[dim] ?? null }))
          const latest = [...rows].reverse().find((r) => r.value !== null)?.value ?? null
          const missing = rows.filter((r) => r.value === null).length
          return (
            // min-w-0: the chart starts at Recharts' initial width, and a grid
            // item will not shrink below its content without it.
            <li key={dim} className="flex min-w-0 flex-col gap-1">
              <p className="flex items-baseline justify-between gap-2 text-sm">
                <span>{dim}</span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {latest === null ? "not measured" : `latest ${formatScore(latest)}`}
                </span>
              </p>
              <ChartContainer
                config={config}
                className="aspect-auto h-10 w-full"
                role="img"
                aria-label={`${dim} over ${points.length} runs${missing > 0 ? `, not measured in ${missing}` : ""}`}
              >
                <LineChart data={rows} margin={{ top: 4, right: 4, bottom: 4, left: 4 }} accessibilityLayer={false}>
                  <YAxis hide domain={[0, 1]} />
                  <Line
                    dataKey="value"
                    stroke="var(--color-value)"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={(props: { cx?: number; cy?: number; index?: number }) => {
                      const i = props.index ?? 0
                      const isolated =
                        rows[i]?.value !== null && (rows[i - 1]?.value ?? null) === null && (rows[i + 1]?.value ?? null) === null
                      return isolated && props.cx !== undefined && props.cy !== undefined ? (
                        <circle key={`dot-${i}`} cx={props.cx} cy={props.cy} r={3} fill="var(--color-value)" />
                      ) : (
                        <g key={`dot-${i}`} />
                      )
                    }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            </li>
          )
        })}
      </ul>
      {unmeasured.length > 0 && (
        <p className="text-sm text-muted-foreground">{`Not measured in these runs: ${unmeasured.join(", ")}.`}</p>
      )}
    </div>
  )
}
