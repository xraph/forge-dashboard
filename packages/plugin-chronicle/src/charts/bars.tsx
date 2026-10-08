import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  LabelList,
  XAxis,
  YAxis,
  type ChartConfig,
} from "@forge-go/dashboard-kit/components/chart"
import { formatSeq } from "../format"
import { formatBucket } from "./series"

/**
 * One ink for every mark. Colour would have to mean something here, and the
 * only thing these charts say is how much, which length already says.
 */
const config = {
  count: { label: "Events", color: "var(--foreground)" },
} satisfies ChartConfig

const ROW = 30
const BAR = 16

/**
 * A breakdown as horizontal bars, in the order given (sorted by the caller).
 * The counts are printed at the bar ends, so no legend, tooltip or value axis
 * is needed. The label names the same numbers for a reader who can't see the
 * picture.
 */
export function HorizontalBars({
  data,
  label,
}: {
  data: { label: string; count: number }[]
  label: string
}) {
  const axisWidth = Math.min(
    180,
    Math.max(48, Math.max(0, ...data.map((d) => d.label.length)) * 7 + 12)
  )
  return (
    <ChartContainer
      config={config}
      role="img"
      aria-label={`${label}: ${data.map((d) => `${d.label} ${formatSeq(d.count)}`).join(", ")}`}
      className="aspect-auto w-full"
      style={{ height: data.length * ROW + 12 }}
    >
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid horizontal vertical={false} stroke="var(--border)" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={axisWidth}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <Bar
          dataKey="count"
          fill="var(--color-count)"
          radius={[0, 4, 4, 0]}
          maxBarSize={BAR}
          isAnimationActive={false}
        >
          <LabelList
            dataKey="count"
            position="right"
            offset={8}
            formatter={(v: unknown) =>
              typeof v === "number" ? formatSeq(v) : ""
            }
            fill="var(--foreground)"
            className="font-mono text-xs tabular-nums"
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/**
 * Volume over time as columns. A bucket the server had nothing for is null and
 * draws nothing: a zero-height bar and a missing one look alike, and only the
 * missing one is honest about the server having recorded no group. A line
 * would join the neighbours across the gap and hide it.
 */
export function VolumeBars({
  series,
  label = "Event volume",
}: {
  series: { bucket: string; count: number | null }[]
  label?: string
}) {
  const described = series
    .map(
      (s) =>
        `${formatBucket(s.bucket, true)} ${s.count === null ? "none" : formatSeq(s.count)}`
    )
    .join(", ")
  return (
    <ChartContainer
      config={config}
      role="img"
      aria-label={`${label}: ${described}`}
      className="aspect-auto h-56 w-full"
    >
      <BarChart
        data={series}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barCategoryGap="20%"
      >
        <CartesianGrid horizontal vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="bucket"
          tickFormatter={(b: string) => formatBucket(b)}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis
          width={44}
          allowDecimals={false}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => formatSeq(v)}
        />
        <ChartTooltip
          filterNull={false}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(b) => formatBucket(String(b), true)}
              formatter={(value) => (
                <span className="font-mono font-medium tabular-nums">
                  {typeof value === "number"
                    ? formatSeq(value)
                    : "Nothing recorded"}
                </span>
              )}
            />
          }
        />
        <Bar
          dataKey="count"
          name="Events"
          fill="var(--color-count)"
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  )
}
