import type { ReactElement } from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  XAxis,
  YAxis,
  type ChartConfig,
} from "@forge-go/dashboard-kit/components/chart"
import { bucketTick, bucketTitle, formatCount } from "../format"
import type { UsageBucket, UsagePeriod } from "../types"

/**
 * The three outcomes, bottom of the stack first. Succeeded sits on the
 * baseline in a neutral grey that recedes, so the two error colours are what
 * the eye lands on. The colours are the spec's, checked with the dataviz
 * validator: the 4xx/5xx pair stays apart for colour-blind readers in both
 * modes. The grey reads as grey on purpose, and 4xx is below 3:1 on the light
 * surface, which is why the legend names every series and the page offers
 * the same numbers as a table. The hex is fixed across light and dark, as the
 * spec settles; axes, grid and tooltip take the kit's tokens.
 */
export const USAGE_CHART_CONFIG = {
  succeeded: { label: "Succeeded", color: "#71717b" },
  clientErrors: { label: "4xx client errors", color: "#ec835a" },
  serverErrors: { label: "5xx server errors", color: "#d03b3b" },
} satisfies ChartConfig

type Series = keyof typeof USAGE_CHART_CONFIG

const SERIES: readonly Series[] = ["succeeded", "clientErrors", "serverErrors"]

const PERIOD_NOUN: Record<UsagePeriod, string> = {
  hourly: "hour",
  daily: "day",
  monthly: "month",
}

/** The surface showing between two stacked segments. */
const GAP = 2
/** The rounded data end on top of a column. */
const RADIUS = 4

interface SegmentProps {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  payload?: Partial<Record<Series, number>>
}

/**
 * How one series draws its segment of a column. The topmost segment with
 * anything in it gets the 4px rounded end, and the base stays square on the
 * baseline. A segment with another one stacked on it gives up its top 2px to
 * the surface, so neighbours read apart by the gap rather than by a stroke.
 * An empty segment draws nothing.
 */
export function segmentShape(series: Series) {
  const above = SERIES.slice(SERIES.indexOf(series) + 1)
  return function Segment({
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    fill,
    payload,
  }: SegmentProps): ReactElement {
    if (height <= 0 || width <= 0) return <g />
    const top = above.every((s) => !payload?.[s])
    const data = {
      "data-series": series,
      "data-top": String(top),
      "data-width": width,
      fill,
    }
    if (top) {
      const r = Math.min(RADIUS, width / 2, height)
      const d =
        `M${x},${y + height}V${y + r}` +
        `A${r},${r} 0 0 1 ${x + r},${y}H${x + width - r}` +
        `A${r},${r} 0 0 1 ${x + width},${y + r}V${y + height}Z`
      return <path {...data} d={d} />
    }
    const h = height - GAP
    if (h <= 0) return <g />
    return <path {...data} d={`M${x},${y + GAP}h${width}v${h}h${-width}Z`} />
  }
}

/**
 * Where a series sits in the tooltip: the legend's order, bottom of the stack
 * first, rather than Recharts' default alphabetical by name.
 */
export function tooltipOrder(item: { dataKey?: unknown }): number {
  return SERIES.indexOf(item.dataKey as Series)
}

/**
 * The tooltip's heading: the hovered bucket named in full, in UTC. Null when
 * the payload carries no bucket start.
 */
export function tooltipTitle(
  payload: readonly { payload?: { start?: unknown } }[] | undefined,
  period: UsagePeriod
): string | null {
  const start = payload?.[0]?.payload?.start
  return typeof start === "string" ? bucketTitle(start, period) : null
}

/**
 * Value-axis ticks for a column whose tallest stack is `max`: whole counts in
 * steps of 1, 2 or 5 times a power of ten, about four of them, from 0 to the
 * first step at or above `max`. An empty range is 0 and 1, so the chart of
 * zeros keeps a baseline with a scale above it.
 */
export function countTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(
    1,
    ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow
  )
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let t = 0; t <= top; t += step) ticks.push(t)
  return ticks
}

/**
 * Requests per UTC bucket, stacked by outcome: succeeded, 4xx, 5xx.
 *
 * Built to the dataviz mark specs: columns at most 24px wide, a 4px rounded
 * top and a square base, a 2px surface gap between segments, horizontal
 * hairline gridlines only, a legend naming every series, and a tooltip per
 * column listing all three. No direct labels: an interior segment has no free
 * end to carry one, and the page's table view holds every number. Every
 * bucket is drawn, empty ones too, so a quiet hour reads as zero. The columns
 * do not animate in, since every filter change refetches and would replay it.
 *
 * `compact` is the key page's small version: no axes, gridlines or legend,
 * just the columns and their tooltip, with a link to Usage beside it.
 */
export function UsageChart({
  buckets,
  period,
  compact = false,
}: {
  buckets: UsageBucket[]
  period: UsagePeriod
  compact?: boolean
}) {
  const rows = buckets.map((b) => ({
    start: b.start,
    tick: bucketTick(b.start, period),
    succeeded: b.succeeded,
    clientErrors: b.clientErrors,
    serverErrors: b.serverErrors,
  }))
  const n = buckets.length
  const ticks = countTicks(
    Math.max(
      0,
      ...buckets.map((b) => b.succeeded + b.clientErrors + b.serverErrors)
    )
  )
  return (
    <ChartContainer
      config={USAGE_CHART_CONFIG}
      role="group"
      aria-label={`Requests per ${PERIOD_NOUN[period]} by outcome, UTC, ${n} ${n === 1 ? "bucket" : "buckets"}`}
      className={
        compact ? "aspect-auto h-24 w-full" : "aspect-auto h-[280px] w-full"
      }
    >
      <BarChart
        data={rows}
        margin={
          compact
            ? { top: 2, right: 0, left: 0, bottom: 0 }
            : { top: 8, right: 8, left: 0, bottom: 0 }
        }
      >
        {!compact && <CartesianGrid vertical={false} />}
        <XAxis
          dataKey="tick"
          hide={compact}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={16}
        />
        <YAxis
          hide={compact}
          tickLine={false}
          axisLine={false}
          width={56}
          // Our own round ticks, since Recharts' can land on steps like
          // 650. allowDataOverflow keeps a range with no requests on its
          // 0 to 1 scale: Recharts drops a stack whose every value is 0
          // unless the domain is fixed and allowed to overflow.
          domain={[0, ticks[ticks.length - 1] ?? 1]}
          ticks={ticks}
          allowDataOverflow
          tickFormatter={(v: number) => formatCount(v)}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)" }}
          itemSorter={tooltipOrder}
          content={
            <ChartTooltipContent
              indicator="line"
              labelFormatter={(_label, payload) =>
                tooltipTitle(payload, period)
              }
            />
          }
        />
        {/* No sorting: the legend reads in stack order, bottom first,
            rather than Recharts' default alphabetical. */}
        {!compact && (
          <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
        )}
        {SERIES.map((s) => (
          <Bar
            key={s}
            dataKey={s}
            stackId="outcome"
            fill={`var(--color-${s})`}
            maxBarSize={24}
            isAnimationActive={false}
            shape={segmentShape(s)}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
